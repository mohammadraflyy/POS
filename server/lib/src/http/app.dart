import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';

import '../core/errors.dart';
import 'api.dart';
import 'routes/auth_routes.dart';
import 'routes/inventory_routes.dart';
import 'routes/purchase_routes.dart';
import 'routes/report_routes.dart';
import 'routes/sales_routes.dart';

/// The whole HTTP API as one shelf handler - no sockets, so tests call it directly.
Handler buildHandler(ApiContext ctx, {void Function(Object error, StackTrace stack)? onUnexpected}) {
  final router = Router(notFoundHandler: (_) => throw NotFoundException('Endpoint tidak ditemukan.'));

  addAuthRoutes(router, ctx);
  addSalesRoutes(router, ctx);
  addPurchaseRoutes(router, ctx);
  addInventoryRoutes(router, ctx);
  addReportRoutes(router, ctx);

  return const Pipeline().addMiddleware(_cors()).addMiddleware(errorMapper(onUnexpected: onUnexpected)).addHandler(router.call);
}

/// Lets a Flutter web build on another origin call the API. Authentication is the bearer
/// token, never a cookie, so allowing any origin exposes nothing a token does not already.
Middleware _cors() {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-file-name',
    'access-control-expose-headers': 'content-disposition',
  };

  return (inner) => (request) async {
        if (request.method == 'OPTIONS') {
          return Response(204, headers: headers);
        }

        final response = await inner(request);

        return response.change(headers: headers);
      };
}
