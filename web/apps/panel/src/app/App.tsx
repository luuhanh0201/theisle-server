import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@isle/ui';
import { UnsavedBar } from '../features/settings-form/UnsavedBar';
import { MutTipLayer } from '../components/dino/Mutations';
import { Routes } from './Routes';
import { SessionProvider } from './session';
import { ConfirmProvider } from './confirm';
import { Shell } from './shell/Shell';
import { hrefOf, useHashRoute } from './router';

// A hidden tab asks nothing (refetchIntervalInBackground off); errors are shown by each page.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, refetchIntervalInBackground: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>
          <ConfirmProvider>
            <Shell><Routes /></Shell>
            <Unsaved />
            <MutTipLayer />
          </ConfirmProvider>
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function Unsaved() {
  const { tab, sub } = useHashRoute();
  return <UnsavedBar here={hrefOf(tab, sub)} />;
}
