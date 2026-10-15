import { FinanceDemoToaster } from "@/components/financeDemo/FinanceDemoToaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { FinanceDemoExitDialog } from '@/components/financeDemo/FinanceDemoExitDialog';
import { FinanceDemoProvider } from "@/contexts/FinanceDemoContext";
import { SucursalProvider } from "@/contexts/SucursalContext";
import { ActionPinGateProvider } from "@/components/ActionPinGate";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Homepage from "./pages/Homepage";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmail from "./pages/VerifyEmail";
import AuthCallback from "./pages/AuthCallback";
import NotFound from "./pages/NotFound";
import Reservar from "./pages/Reservar";
import AdminApp from "@/admin/AdminApp";
import Partners from './pages/Partners';
import PartnerPanel from './pages/PartnerPanel';

const queryClient = new QueryClient();

// Sonner es un singleton global (un solo store de toasts compartido por
// cualquier <Sonner/> montado) — nunca montar una segunda instancia, eso
// duplicaría cada toast. En vez de eso, un único Toaster cuya posición
// reacciona a la ruta: top-center en las páginas públicas (Homepage, Login,
// Reservar) para no taparse con el banner de cookies fijo abajo; bottom-right
// (el default de siempre) en el resto, incluida la app interna /app/:orgSlug.
const PUBLIC_TOP_CENTER_ROUTES = [/^\/$/, /^\/login$/, /^\/aliados(?:\/|$)/, /^\/[^/]+\/reservar$/];

function AppToaster() {
  const { pathname } = useLocation();
  const isPublicPage = PUBLIC_TOP_CENTER_ROUTES.some((re) => re.test(pathname));
  return <FinanceDemoToaster position={isPublicPage ? "top-center" : "bottom-right"} />;
}

function TenantProviders() {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <SucursalProvider>
          <FinanceDemoProvider>
            <ActionPinGateProvider>
              <OnboardingProvider>
                <Outlet />
              </OnboardingProvider>
            </ActionPinGateProvider>
            <FinanceDemoExitDialog />
          </FinanceDemoProvider>
        </SucursalProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AppToaster />
        <Routes>
          <Route path="/aliados" element={<Partners />} />
          <Route path="/aliados/panel" element={<PartnerPanel />} />
          <Route
            path="/admin/*"
            element={
              <AdminAuthProvider>
                <AdminApp />
              </AdminAuthProvider>
            }
          />
          <Route element={<TenantProviders />}>
            <Route path="/" element={<Homepage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/:orgSlug/reservar" element={<Reservar />} />
            <Route
              path="/app/:orgSlug"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
