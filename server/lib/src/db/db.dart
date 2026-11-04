import 'package:sqlite3/sqlite3.dart';

import 'schema.dart';

typedef Row = Map<String, Object?>;

/// Thin wrapper over a `sqlite3` connection: positional-parameter queries that hand
/// back plain maps, and transactions that nest through savepoints so a domain
/// function can open one without caring whether its caller already did.
///
/// SQLite is synchronous and single-writer. The server owns the only connection to
/// the file, which is the whole point - two processes writing one SQLite file is how
/// locks and corruption are born.
class Db {
  Db._(this.raw);

  final Database raw;
  int _depth = 0;

  /// Opens (creating if needed) the database at [path], or an in-memory one for
  /// `':memory:'`, and brings its schema up to date.
  factory Db.open(String path) {
    final database = path == ':memory:' ? sqlite3.openInMemory() : sqlite3.open(path);
    final db = Db._(database);

    if (path != ':memory:') {
      database.execute('PRAGMA journal_mode = WAL');
      database.execute('PRAGMA synchronous = NORMAL');
    }

    database.execute('PRAGMA busy_timeout = 5000');
    migrate(db);
    database.execute('PRAGMA foreign_keys = ON');

    return db;
  }

  List<Row> select(String sql, [List<Object?> params = const []]) {
    final result = raw.select(sql, params);

    return [for (final row in result) Map<String, Object?>.of(row)];
  }

  Row? first(String sql, [List<Object?> params = const []]) {
    final rows = select(sql, params);

    return rows.isEmpty ? null : rows.first;
  }

  /// The first column of the first row, or null.
  T? scalar<T>(String sql, [List<Object?> params = const []]) {
    final result = raw.select(sql, params);

    return result.isEmpty ? null : result.first.columnAt(0) as T?;
  }

  /// Runs a write; returns the number of rows it changed.
  int execute(String sql, [List<Object?> params = const []]) {
    raw.execute(sql, params);

    return raw.updatedRows;
  }

  /// Runs an INSERT; returns the new row's id.
  int insert(String sql, [List<Object?> params = const []]) {
    raw.execute(sql, params);

    return raw.lastInsertRowId;
  }

  /// Runs [action] atomically. Nested calls become savepoints, so an inner failure
  /// rolls back only its own work and rethrows to the outer transaction.
  T transaction<T>(T Function() action) {
    final savepoint = 'sp_${_depth + 1}';

    raw.execute(_depth == 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT $savepoint');
    _depth++;

    try {
      final result = action();
      _depth--;
      raw.execute(_depth == 0 ? 'COMMIT' : 'RELEASE $savepoint');

      return result;
    } catch (_) {
      _depth--;

      if (_depth == 0) {
        raw.execute('ROLLBACK');
      } else {
        raw.execute('ROLLBACK TO $savepoint');
        raw.execute('RELEASE $savepoint');
      }

      rethrow;
    }
  }

  void close() => raw.close();
}

/// Unix seconds - how every `created_at`/`updated_at` column is stored, matching
/// the desktop app's drizzle `timestamp` mode so imported rows read the same.
int toEpochSeconds(DateTime time) => time.millisecondsSinceEpoch ~/ 1000;

DateTime fromEpochSeconds(int seconds) => DateTime.fromMillisecondsSinceEpoch(seconds * 1000);

int nowSeconds() => toEpochSeconds(DateTime.now());

/// SQLite hands back 0/1 for boolean columns.
bool asBool(Object? value) => value == 1 || value == true;
