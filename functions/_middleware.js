export async function onRequest(context) {
  // Pages may retain a removed static asset at an edge for up to a week.
  // The routing allowlist sends private source paths here to override that cache.
  const response = new URL(context.request.url).pathname.startsWith('/api/')
      ? await context.next()
      : new Response('Not found', { status: 404 }),
    headers = new Headers(response.headers);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
