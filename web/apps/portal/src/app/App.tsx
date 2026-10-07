import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { launcherUi } from '../lib/launcher';
import { LauncherShell } from './launcher/LauncherShell';
import { Shell } from './Shell';
import { ToastProvider } from './toast';

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, refetchIntervalInBackground: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {/* Inside the launcher its own look (app/launcher/), unless the player chose the web's. */}
        {launcherUi() ? <LauncherShell /> : <Shell />}
      </ToastProvider>
    </QueryClientProvider>
  );
}
