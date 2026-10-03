import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LoadingScreen, RecoverableErrorScreen, useLoadingScreenMounted } from './LoadingScreen';
import { SubscriptionGate } from './billing/SubscriptionGate';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, roles, isLoading, authError, mustChangePassword, signOut, refreshProfile } = useAuth();
  const { organization, isLoading: orgLoading, error: orgError, refreshOrganization } = useOrganization();
  const {
    access: subscriptionAccess,
    isLoading: subscriptionLoading,
    error: subscriptionError,
    refreshAccess,
  } = useSubscriptionAccess();
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const [passwordChanged, setPasswordChanged] = useState(false);
  const authOrgSubscriptionLoading = isLoading || orgLoading || subscriptionLoading;
  const showLoadingScreen = useLoadingScreenMounted(authOrgSubscriptionLoading);

  // 1a. Error explícito cargando perfil/roles → no esperar 90s, mostrar pantalla recuperable.
  if (user && authError && !isLoading) {
    return (
      <RecoverableErrorScreen
        title="Tu sesión se inició, pero no pudimos cargar tu perfil"
        description={authError}
        onRetry={() => refreshProfile()}
        onSignOut={async () => {
          await signOut();
          window.location.href = '/login';
        }}
      />
    );
  }

  // 1b. Mientras realmente se está inicializando, mostrar loader con fallback progresivo.
  if (showLoadingScreen) {
    return (
      <LoadingScreen
        loading={authOrgSubscriptionLoading}
        message="Verificando sesión..."
        onRetry={() => {
          void refreshOrganization();
          void refreshAccess();
        }}
      />
    );
  }

  // 2. Sin sesión → al login.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 3. Email no verificado (excepto invitados).
  const isInvited = user.user_metadata?.invited_by != null;
  if (!user.email_confirmed_at && !isInvited) {
    return <Navigate to="/verify-email" replace />;
  }

  // 4. Forzar cambio de contraseña si corresponde.
  if (mustChangePassword && !passwordChanged) {
    return <ChangePasswordForm onSuccess={() => setPasswordChanged(true)} />;
  }

  // 5. Hay user pero la organización no se pudo cargar → pantalla recuperable.
  if (!organization && orgError) {
    return (
      <RecoverableErrorScreen
        title="Tu sesión se inició, pero no pudimos cargar los datos de tu organización"
        description={orgError}
        onRetry={() => refreshOrganization()}
        onSignOut={async () => {
          await signOut();
          window.location.href = '/login';
        }}
      />
    );
  }


  // 6. Validar slug en URL.
  if (orgSlug && organization && orgSlug !== organization.slug) {
    return <Navigate to={`/app/${organization.slug}`} replace />;
  }

  if (organization && subscriptionError) {
    return (
      <RecoverableErrorScreen
        title="No pudimos verificar tu suscripciÃ³n"
        description={subscriptionError}
        onRetry={() => refreshAccess()}
        onSignOut={async () => {
          await signOut();
          window.location.href = '/login';
        }}
      />
    );
  }

  if (organization && subscriptionAccess && !subscriptionAccess.has_access) {
    return <SubscriptionGate access={subscriptionAccess} onRetry={refreshAccess} />;
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = requiredRoles.some(role => roles.includes(role));
    if (!hasRequiredRole) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-destructive mb-2">Acceso Denegado</h1>
            <p className="text-muted-foreground">No tenés permisos para acceder a esta sección.</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
