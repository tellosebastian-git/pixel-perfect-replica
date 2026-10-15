import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import AdminLogin from '@/admin/AdminLogin';
import { AdminProtectedRoute, AdminGuestRoute } from '@/admin/AdminProtectedRoute';
import { AdminShell } from '@/admin/AdminShell';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_ALIAS, useAdminAuth } from '@/contexts/AdminAuthContext';

const AdminOverviewPage = lazy(() => import('@/admin/pages/AdminOverviewPage'));
const AdminOrganizationsPage = lazy(() => import('@/admin/pages/AdminOrganizationsPage'));
const AdminOrganizationDetailPage = lazy(() => import('@/admin/pages/AdminOrganizationDetailPage'));
const AdminUsersPage = lazy(() => import('@/admin/pages/AdminUsersPage'));
const AdminSubscriptionsPage = lazy(() => import('@/admin/pages/AdminSubscriptionsPage'));
const AdminAuditPage = lazy(() => import('@/admin/pages/AdminAuditPage'));
const AdminPartnersPage = lazy(() => import('@/admin/pages/AdminPartnersPage'));

function AdminLoginRoute() {
  const { signIn, isLoading, issue, clearIssue } = useAdminAuth();

  return (
    <AdminLogin
      isSubmitting={isLoading}
      error={issue?.message ?? null}
      onSignIn={async (username, password) => {
        clearIssue();
        const result = await signIn(username, password);
        if (result.error) throw result.error;
      }}
    />
  );
}

function AdminShellRoute() {
  const { signOut } = useAdminAuth();
  return (
    <AdminShell actorLabel={ADMIN_ALIAS} onSignOut={signOut}>
      <Suspense fallback={<AdminPageSkeleton />}>
        <Outlet />
      </Suspense>
    </AdminShell>
  );
}

function AdminPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando sección administrativa">
      <div className="flex items-start gap-3 pl-14 sm:pl-0">
        <Skeleton className="h-10 w-10 rounded-tile" />
        <div className="space-y-2 pt-1"><Skeleton className="h-6 w-44" /><Skeleton className="h-4 w-72 max-w-full" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-36 rounded-container" />)}
      </div>
      <Skeleton className="h-80 rounded-container" />
    </div>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminGuestRoute />}>
        <Route path="login" element={<AdminLoginRoute />} />
      </Route>

      <Route element={<AdminProtectedRoute />}>
        <Route element={<AdminShellRoute />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="barberias" element={<AdminOrganizationsPage />} />
          <Route path="barberias/:organizationId" element={<AdminOrganizationDetailPage />} />
          <Route path="usuarios" element={<AdminUsersPage />} />
          <Route path="suscripciones" element={<AdminSubscriptionsPage />} />
          <Route path="auditoria" element={<AdminAuditPage />} />
          <Route path="aliados" element={<AdminPartnersPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
