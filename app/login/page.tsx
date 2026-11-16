import { signIn } from '@/lib/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-line bg-white p-8 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            SAS Award Watcher
          </h1>
          <p className="text-sm text-muted">Sign in to see your trips</p>
        </div>

        {params.error && (
          <div
            role="alert"
            className="rounded-lg bg-orange-100 px-4 py-3 text-sm text-orange-900"
          >
            {params.error === 'AccessDenied'
              ? 'This account does not have access.'
              : 'Sign-in failed because of a setup problem, not your account.'}
          </div>
        )}

        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white hover:bg-brand"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
