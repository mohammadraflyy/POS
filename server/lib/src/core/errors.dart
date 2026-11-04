/// A rejection the user should read as-is: failed validation, not enough stock,
/// a record that does not exist. The HTTP layer turns it into a 400 whose `error`
/// is [message], so every message is written in Bahasa Indonesia for the cashier.
class BusinessException implements Exception {
  BusinessException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// The caller is not signed in, or their token has been revoked (HTTP 401).
class UnauthorizedException implements Exception {
  UnauthorizedException([this.message = 'Silakan login terlebih dahulu.']);

  final String message;

  @override
  String toString() => message;
}

/// The caller is signed in but lacks the role for this action (HTTP 403).
class ForbiddenException implements Exception {
  ForbiddenException([this.message = 'Hanya admin yang dapat melakukan aksi ini.']);

  final String message;

  @override
  String toString() => message;
}

/// The thing asked for does not exist (HTTP 404).
class NotFoundException implements Exception {
  NotFoundException(this.message);

  final String message;

  @override
  String toString() => message;
}
