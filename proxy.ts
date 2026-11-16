import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Everything except the login page needs a signed-in, allowed user.
export const proxy = auth((req) => {
  if (!req.auth && req.nextUrl.pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
  }

  if (req.auth && req.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
