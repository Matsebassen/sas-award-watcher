import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

// Same setup as middag-app: Google sign-in, and only the addresses in
// ALLOWED_EMAILS (comma-separated) get in.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    signIn({ profile }) {
      const allowed =
        process.env.ALLOWED_EMAILS?.split(',').map((e) => e.trim()) ?? [];
      return allowed.includes(profile?.email ?? '');
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
});
