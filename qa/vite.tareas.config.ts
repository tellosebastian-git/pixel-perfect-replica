// QA local de Principal → Tareas: mismo proyecto, con contextos/PIN/Supabase sustituidos por qa/tareas-mocks.tsx.
// No participa del build de producción (vite.config.ts no lo referencia).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

const root = path.resolve(__dirname, '..');
// Tailwind resuelve sus globs `content` desde el directorio de trabajo: se fija en este checkout aunque
// el servidor se lance desde otro (por ejemplo, desde el panel de vista previa del checkout principal).
process.chdir(root);
const mocks = path.resolve(__dirname, './tareas-mocks.tsx');
export default defineConfig({
  root,
  server: { host: 'localhost', port: 8091, strictPort: true },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/contexts\/(AuthContext|OrganizationContext|SucursalContext)$/, replacement: mocks },
      { find: /^@\/components\/ActionPinGate$/, replacement: mocks },
      { find: /^@\/integrations\/supabase\/client$/, replacement: mocks },
      { find: /^@\/hooks\/useOrganizationToday$/, replacement: mocks },
      { find: '@', replacement: path.resolve(root, 'src') },
    ],
  },
});
