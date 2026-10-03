import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
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

const queryClient = new QueryClient();

// Sonner es un singleton global (un solo store de toasts compartido por
// cualquier <Sonner/> montado) — nunca montar una segunda instancia, eso
// duplicaría cada toast. En vez de eso, un único Toaster cuya posición
// reacciona a la ruta: top-center en las páginas públicas (Homepage, Login,
// Reservar) para no taparse con el banner de cookies fijo abajo; bottom-right
// (el default de siempre) en el resto, incluida la app interna /app/:orgSlug.
const PUBLIC_TOP_CENTER_ROUTES = [/^\/$/, /^\/login$/, /^\/[^/]+\/reservar$/];

function AppToaster() {
  const { pathname } = useLocation();
  const isPublicPage = PUBLIC_TOP_CENTER_ROUTES.some((re) => re.test(pathname));
  return <Sonner position={isPublicPage ? "top-center" : "bottom-right"} />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <OrganizationProvider>
          <SucursalProvider>
            <ActionPinGateProvider>
              <OnboardingProvider>
              <BrowserRouter>
                <AppToaster />
                <Routes>
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
                </Routes>
              </BrowserRouter>
              </OnboardingProvider>
            </ActionPinGateProvider>
          </SucursalProvider>
        </OrganizationProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
