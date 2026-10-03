import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from '@/components/ui/form';
import { EditableSectionHeader } from '@/components/ui/EditableSectionHeader';
import { Copy, ExternalLink, Download, Upload, Trash2, Link as LinkIcon, QrCode, Palette, Type, Globe, ChevronDown, Image as ImageIcon, UserRound, BarChart3, Info } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  usePortalConfig,
  isValidHex,
  getLogoPublicUrl,
  getCoverPublicUrl,
  type PortalLink,
} from '@/hooks/usePortalConfig';
import { usePortalHasServices } from '@/hooks/usePortalHasServices';
import { PortalLinksEditor } from './PortalLinksEditor';
import { PortalPreview } from './PortalPreview';
import { PortalColorPalette } from './PortalColorPalette';
import { PortalCoverUploader } from './PortalCoverUploader';
import { PortalCoverPositionDialog } from './PortalCoverPositionDialog';
import { isValidIconKey } from '@/components/reservar/lib/portalIcons';
import { cn } from '@/lib/utils';

const URL_RE = /^https?:\/\//i;

// "Logo y portada" no tiene schema propio — sigue siendo autosave puro
// (Opción C), sin useForm ni modo edición. logoPath/coverPath/cover_* no
// tienen regla de validación (ya la aplica usePortalConfig al momento de
// subir el archivo) ni necesitan isDirty (se autoguardan sin pasar por
// ningún submit) — por eso viven en un useState simple, no en RHF.
type PortalMedia = {
  logoPath: string | null;
  coverPath: string | null;
  coverPosX: number;
  coverPosY: number;
  coverZoom: number;
};

const emptyMedia: PortalMedia = {
  logoPath: null,
  coverPath: null,
  coverPosX: 50,
  coverPosY: 50,
  coverZoom: 1,
};

// Fase 9: Integraciones — primer piloto del patrón de modo lectura/edición.
const integracionesSchema = z.object({
  metaPixelId: z.string().trim().optional().default('')
    .refine((v) => !v || /^[0-9]{10,20}$/.test(v), 'El ID debe tener solo números, entre 10 y 20 dígitos.'),
});
type IntegracionesFormValues = z.infer<typeof integracionesSchema>;
const integracionesEmptyValues: IntegracionesFormValues = { metaPixelId: '' };

// Fase 10: "Contenido del portal" — descripción + links, ambos alimentan
// previewPortal en vivo mientras esta Card está en edición.
const linkSchema = z.object({
  label: z.string().trim().min(1, 'La etiqueta no puede quedar vacía.').max(80, 'La etiqueta no puede superar los 80 caracteres.'),
  url: z.string(),
  active: z.boolean(),
  sort_order: z.number(),
  icon: z.string().nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.active && (!URL_RE.test(data.url) || data.url.length > 500)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Debe empezar con http:// o https://' });
  }
  if (data.icon && !isValidIconKey(data.icon)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['icon'], message: 'Ícono inválido.' });
  }
});

const contenidoSchema = z.object({
  description: z.string().max(240, 'La descripción supera 240 caracteres.').optional().default(''),
  links: z.array(linkSchema).max(4, 'Máximo 4 links'),
});
type ContenidoFormValues = z.infer<typeof contenidoSchema>;
const contenidoEmptyValues: ContenidoFormValues = { description: '', links: [] };

// Fase 11: "Nombre y color" — mitad de la ex "Identidad visual" que sí
// requiere guardado explícito (la otra mitad, Logo y portada, es autosave).
// Guardado cross-tabla: orgName va a organizations, primaryColor a
// portal_config — mismo manejo de fallo parcial que tenía el form legacy.
const nombreColorSchema = z.object({
  orgName: z.string().trim().min(1, 'El nombre del negocio no puede quedar vacío.').max(80, 'El nombre del negocio supera los 80 caracteres.'),
  primaryColor: z.string().optional().default('').refine((v) => !v || isValidHex(v), 'El color debe tener formato #RRGGBB'),
});
type NombreColorFormValues = z.infer<typeof nombreColorSchema>;
const nombreColorEmptyValues: NombreColorFormValues = { orgName: '', primaryColor: '' };

interface PortalPublicoSectionProps {
  /** Avisa a AgendaManagement.tsx si hay cambios sin guardar, para que pueda
      bloquear el cambio de tab con un aviso de "¿Descartar cambios?". */
  onDirtyChange?: (dirty: boolean) => void;
}

// Se agrega un miembro por cada Card que migra al patrón de modo
// lectura/edición. "Logo y portada" nunca entra acá — es autosave puro,
// sin editing (Opción C). Mismo mecanismo que AgendaConfigSection.tsx y
// ClienteDetailDialog.tsx (ese último ya lo corre con 4 secciones).
type EditingSection = 'integraciones' | 'contenido' | 'nombreColor' | null;

export function PortalPublicoSection({ onDirtyChange }: PortalPublicoSectionProps) {
  const { organization, isLoading: orgLoading, updateOrganization } = useOrganization();
  const orgId = organization?.id;
  const {
    config, loading, saving, save,
    uploadLogo, removeLogo,
    uploadCover, removeCover,
  } = usePortalConfig(orgId);
  const hasServices = usePortalHasServices(orgId);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [removingCover, setRemovingCover] = useState(false);
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [editing, setEditing] = useState<EditingSection>(null);
  // Pestaña activa dentro de "Logo y portada" — puramente de presentación,
  // sin relación con editing: esta Card no tiene modo edición (autosave).
  const [mediaTab, setMediaTab] = useState<'logo' | 'portada'>('logo');
  // Pestaña activa dentro de "Compartir tu portal" — arranca en el link,
  // que es la acción más frecuente de la sección.
  const [shareTab, setShareTab] = useState<'link' | 'qr'>('link');
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const hasSeededRef = useRef(false);

  // Contenedor reactivo de logo/portada — ver comentario en PortalMedia.
  const [media, setMedia] = useState<PortalMedia>(emptyMedia);

  const integracionesForm = useForm<IntegracionesFormValues>({
    resolver: zodResolver(integracionesSchema),
    defaultValues: integracionesEmptyValues,
  });
  const { isDirty: integracionesDirty, isSubmitting: integracionesSubmitting } = integracionesForm.formState;

  const contenidoForm = useForm<ContenidoFormValues>({
    resolver: zodResolver(contenidoSchema),
    defaultValues: contenidoEmptyValues,
  });
  const { isDirty: contenidoDirty, isSubmitting: contenidoSubmitting } = contenidoForm.formState;

  const nombreColorForm = useForm<NombreColorFormValues>({
    resolver: zodResolver(nombreColorSchema),
    defaultValues: nombreColorEmptyValues,
  });
  const { isDirty: nombreColorDirty, isSubmitting: nombreColorSubmitting } = nombreColorForm.formState;

  useEffect(() => {
    onDirtyChange?.(contenidoDirty || nombreColorDirty || integracionesDirty);
  }, [contenidoDirty, nombreColorDirty, integracionesDirty, onDirtyChange]);

  // Nombre (organizations) y el resto (portal_config) son dos fetches
  // independientes con timings distintos — el reset inicial espera a que
  // ambos resuelvan, una sola vez, para no pisar texto que el usuario ya
  // empezó a escribir con un reset tardío. Mismo gate para los 3 forms de
  // Card: todos dependen de la misma condición de datos listos.
  useEffect(() => {
    if (hasSeededRef.current) return;
    if (orgLoading || loading || !organization || !config) return;
    hasSeededRef.current = true;
    setMedia({
      logoPath: config.logo_path,
      coverPath: config.cover_path,
      coverPosX: config.cover_position_x ?? 50,
      coverPosY: config.cover_position_y ?? 50,
      coverZoom: config.cover_zoom ?? 1,
    });
    contenidoForm.reset({
      description: config.description ?? '',
      links: config.links ?? [],
    });
    nombreColorForm.reset({
      orgName: organization.name ?? '',
      primaryColor: config.primary_color ?? '',
    });
    integracionesForm.reset({ metaPixelId: config.meta_pixel_id ?? '' });
  }, [orgLoading, loading, organization, config, contenidoForm, nombreColorForm, integracionesForm]);

  const watchedLogoPath = media.logoPath;
  const watchedCoverPath = media.coverPath;
  const watchedCoverPosX = media.coverPosX;
  const watchedCoverPosY = media.coverPosY;
  const watchedCoverZoom = media.coverZoom;

  // watch() se llama siempre, incondicional (regla de hooks) — la selección
  // de cuál fuente manda (form en edición vs. config guardado) ocurre más
  // abajo, al armar previewPortal y el derivado orgName.
  const contenidoDescriptionWatch = contenidoForm.watch('description');
  const contenidoLinksWatch = contenidoForm.watch('links');
  const nombreColorOrgNameWatch = nombreColorForm.watch('orgName');
  const nombreColorPrimaryColorWatch = nombreColorForm.watch('primaryColor');

  const publicUrl = useMemo(() => {
    if (!organization?.slug) return '';
    return `${window.location.origin}/${organization.slug}/reservar`;
  }, [organization?.slug]);

  const logoUrl = useMemo(() => getLogoPublicUrl(watchedLogoPath), [watchedLogoPath]);
  const coverUrl = useMemo(() => getCoverPublicUrl(watchedCoverPath), [watchedCoverPath]);

  // Logo/portada: sin condicional — son autosave, siempre reflejan el valor
  // más reciente sin ambigüedad de "cuál form manda" (no tienen editing).
  // Descripción/links/color: mientras su Card está en edición, la preview
  // sigue el borrador en vivo (watch); si no, refleja lo último guardado
  // (config). editing es un puntero único — nunca hay dos Cards en edición
  // a la vez, así que no hay caso ambiguo de "cuál de las dos manda".
  const previewDescription = editing === 'contenido' ? contenidoDescriptionWatch : (config?.description ?? '');
  const previewLinks = editing === 'contenido' ? contenidoLinksWatch : (config?.links ?? []);
  const previewPrimaryColorRaw = editing === 'nombreColor' ? nombreColorPrimaryColorWatch : (config?.primary_color ?? '');

  const previewPortal = useMemo(() => ({
    logo_url: logoUrl || organization?.logo_url || null,
    cover_url: coverUrl || null,
    cover_position_x: watchedCoverPosX,
    cover_position_y: watchedCoverPosY,
    cover_zoom: watchedCoverZoom,
    description: previewDescription.trim() || null,
    primary_color: isValidHex(previewPrimaryColorRaw) ? previewPrimaryColorRaw : null,
    links: previewLinks
      .filter((l) => l.active && l.label.trim() && URL_RE.test(l.url))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ label: l.label, url: l.url, icon: l.icon ?? null })),
  }), [logoUrl, coverUrl, watchedCoverPosX, watchedCoverPosY, watchedCoverZoom, organization?.logo_url, previewDescription, previewPrimaryColorRaw, previewLinks]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCopy = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    toast.success('Link copiado');
  };

  const handleDownloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `vittro-portal-${organization?.slug || 'qr'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleLogoFile = async (file: File) => {
    setUploadingLogo(true);
    const { error, path } = await uploadLogo(file);
    if (error) {
      setUploadingLogo(false);
      return toast.error(error.message);
    }
    if (path) {
      setMedia((m) => ({ ...m, logoPath: path }));
      const { error: e } = await save({ logo_path: path });
      setUploadingLogo(false);
      if (e) toast.error('No se pudo guardar el logo');
      else toast.success('Logo actualizado');
    } else {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    setRemovingLogo(true);
    setMedia((m) => ({ ...m, logoPath: null }));
    const { error } = await removeLogo();
    setRemovingLogo(false);
    if (error) toast.error('No se pudo quitar el logo');
    else toast.success('Logo quitado');
  };

  const handleCoverFile = async (file: File) => {
    setUploadingCover(true);
    const { error, path } = await uploadCover(file);
    if (error) {
      setUploadingCover(false);
      return toast.error(error.message);
    }
    if (path) {
      setMedia((m) => ({ ...m, coverPath: path, coverPosX: 50, coverPosY: 50, coverZoom: 1 }));
      const { error: e } = await save({ cover_path: path, cover_position_x: 50, cover_position_y: 50, cover_zoom: 1 });
      setUploadingCover(false);
      if (e) toast.error('No se pudo guardar la portada');
      else toast.success('Portada actualizada');
    } else {
      setUploadingCover(false);
    }
  };

  const handleRemoveCover = async () => {
    setRemovingCover(true);
    setMedia((m) => ({ ...m, coverPath: null, coverPosX: 50, coverPosY: 50, coverZoom: 1 }));
    const { error } = await removeCover();
    setRemovingCover(false);
    if (error) toast.error('No se pudo quitar la portada');
    else toast.success('Portada quitada');
  };

  const handleSaveCoverPosition = async (x: number, y: number, zoom: number) => {
    setMedia((m) => ({ ...m, coverPosX: x, coverPosY: y, coverZoom: zoom }));
    const { error } = await save({ cover_position_x: x, cover_position_y: y, cover_zoom: zoom });
    if (error) toast.error('No se pudo guardar el encuadre');
    else toast.success('Encuadre guardado');
  };

  // --- Integraciones (Fase 9) ---
  const startEditingIntegraciones = () => {
    integracionesForm.reset({ metaPixelId: config?.meta_pixel_id ?? '' });
    setEditing('integraciones');
  };

  const cancelEditIntegraciones = () => {
    integracionesForm.reset({ metaPixelId: config?.meta_pixel_id ?? '' });
    setEditing(null);
  };

  const onSubmitIntegraciones = async (values: IntegracionesFormValues) => {
    const { error } = await save({ meta_pixel_id: values.metaPixelId.trim() || null });
    if (error) {
      toast.error('No se pudo guardar el ID de píxel');
      return;
    }
    toast.success('Cambios guardados');
    integracionesForm.reset(values);
    setEditing(null);
  };

  const handleSaveIntegraciones = () => {
    void integracionesForm.handleSubmit(onSubmitIntegraciones)();
  };

  // --- Contenido del portal (Fase 10) ---
  const startEditingContenido = () => {
    contenidoForm.reset({
      description: config?.description ?? '',
      links: config?.links ?? [],
    });
    setEditing('contenido');
  };

  const cancelEditContenido = () => {
    contenidoForm.reset({
      description: config?.description ?? '',
      links: config?.links ?? [],
    });
    setEditing(null);
  };

  const handleLinksChange = (next: PortalLink[]) => {
    contenidoForm.setValue('links', next, { shouldDirty: true, shouldValidate: true });
  };

  const onSubmitContenido = async (values: ContenidoFormValues) => {
    const normalizedLinks: PortalLink[] = values.links.map((l, i) => ({
      ...l,
      label: l.label.trim(),
      url: l.url ?? '',
      active: l.active ?? true,
      sort_order: i,
      icon: isValidIconKey(l.icon) ? l.icon : null,
    })) as PortalLink[];

    const { error } = await save({
      description: values.description.trim() || null,
      links: normalizedLinks,
    });
    if (error) {
      toast.error(`No se pudo guardar: ${error.message}`);
      return;
    }
    toast.success('Cambios guardados');
    contenidoForm.reset({ description: values.description, links: normalizedLinks });
    setEditing(null);
  };

  const handleSaveContenido = () => {
    void contenidoForm.handleSubmit(onSubmitContenido)();
  };

  // --- Nombre y color (Fase 11) ---
  const startEditingNombreColor = () => {
    nombreColorForm.reset({
      orgName: organization?.name ?? '',
      primaryColor: config?.primary_color ?? '',
    });
    setEditing('nombreColor');
  };

  const cancelEditNombreColor = () => {
    nombreColorForm.reset({
      orgName: organization?.name ?? '',
      primaryColor: config?.primary_color ?? '',
    });
    setEditing(null);
  };

  const handleColorPreset = (hex: string) => {
    nombreColorForm.setValue('primaryColor', hex, { shouldDirty: true, shouldValidate: true });
  };

  const onSubmitNombreColor = async (values: NombreColorFormValues) => {
    // organizations.name — solo si cambió. Si falla, abortamos sin tocar
    // portal_config para no dejar los datos a medio guardar.
    const nameChanged = values.orgName !== (organization?.name ?? '');
    if (nameChanged) {
      const { error: orgError } = await updateOrganization({ name: values.orgName });
      if (orgError) {
        toast.error(`No se pudo actualizar el nombre del negocio: ${orgError.message}`);
        return;
      }
    }

    // portal_config — el nombre ya quedó guardado, así que un fallo acá no
    // puede reportarse como "no se guardó nada".
    const { error } = await save({ primary_color: values.primaryColor || null });
    if (error) {
      toast.error(
        nameChanged
          ? `El nombre del negocio se guardó, pero no se pudo guardar el resto: ${error.message}`
          : `No se pudo guardar: ${error.message}`,
      );
      return;
    }

    toast.success('Cambios guardados');
    nombreColorForm.reset(values);
    setEditing(null);
  };

  const handleSaveNombreColor = () => {
    void nombreColorForm.handleSubmit(onSubmitNombreColor)();
  };

  if (!orgId) return null;

  if (orgLoading || loading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        {/* Espeja "Compartir tu portal" (izquierda) + Vista previa. La pestaña
            por defecto es Link público (D28: el skeleton antes mostraba
            también un QR, que solo aparece si el usuario cambia a esa
            pestaña) — ver docs/MODULOS/turnos-agenda.md. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4 min-w-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-9 w-56 sm:max-w-xs" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <Skeleton className="h-10 w-full sm:flex-1" />
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-[420px] w-full rounded-[2rem] mx-auto max-w-[340px]" />
          </div>
        </div>
        {/* Espeja la columna única de Cards. */}
        <div className="max-w-3xl space-y-6">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // orgName: en lectura, el nombre guardado de la organización. En edición
  // de "Nombre y color", sigue el borrador en vivo (si queda vacío mientras
  // se edita, cae al nombre ya guardado, no al placeholder genérico). Se
  // calcula acá y no adentro de la Card porque lo consumen 5 lugares:
  // aria-label del QR, PortalPreview, inicial del avatar sin logo,
  // descPlaceholder del Textarea, y PortalCoverPositionDialog.
  const orgName = editing === 'nombreColor'
    ? (nombreColorOrgNameWatch.trim() || organization?.name || 'Mi Barbería')
    : (organization?.name || 'Mi Barbería');
  const descPlaceholder = `Bienvenido al portal de reservas de ${orgName}. Reservá tu turno o gestioná tu cita de forma simple.`;

  const linkErrors = contenidoForm.formState.errors.links;
  const linksArrayMessage = linkErrors && !Array.isArray(linkErrors) ? linkErrors.message : undefined;

  return (
    <>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        {/* Barra de accesos — solo desktop */}
        <nav className="hidden md:block sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 py-2 shadow-sm">
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => scrollTo('portal-logo-portada')}
              className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Logo y portada
            </button>
            <button
              type="button"
              onClick={() => scrollTo('portal-nombre-color')}
              className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Nombre y color
            </button>
            <button
              type="button"
              onClick={() => scrollTo('portal-contenido')}
              className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Contenido
            </button>
            <button
              type="button"
              onClick={() => scrollTo('portal-integraciones')}
              className="shrink-0 rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Integraciones
            </button>
          </div>
        </nav>

        {/* === Bloque superior — Compartir + Vista previa ===
            Sin ningún campo registrado en RHF, solo contenido de solo
            lectura y acciones (todos los botones son type="button"). No se
            toca en esta fase. */}
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Compartir tu portal — min-w-0 va en la Card (no en un wrapper
              aparte): evita que la URL con break-all desborde el track de
              la grilla. */}
          <Card className="min-w-0">
            <CardHeader className="pb-0">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <h2 className="text-sm font-semibold">Compartir tu portal</h2>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <SegmentedControl
                options={[
                  { value: 'link', label: 'Link público' },
                  { value: 'qr', label: 'QR' },
                ]}
                value={shareTab}
                onChange={(v) => setShareTab(v as 'link' | 'qr')}
                className="sm:max-w-xs"
              />

              {/* Link público */}
              {shareTab === 'link' && (
                <div role="tabpanel" aria-label="Link público del portal" className="space-y-2">
                  <div>
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" /> Link público del portal
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Compartilo con tus clientes para que reserven o gestionen su cita.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    {/* No es un input: evita el foco y el auto-zoom de iOS, y permite ver la URL completa en 2 lineas */}
                    <div
                      title={publicUrl}
                      className="w-full sm:w-auto rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs min-h-10 flex-1 min-w-0 select-all break-all whitespace-normal"
                    >
                      {publicUrl}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                        <Copy className="h-4 w-4 mr-1" /> Copiar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => publicUrl && window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" /> Ver portal
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* QR */}
              {shareTab === 'qr' && (
                <div role="tabpanel" aria-label="QR de reserva" className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <QrCode className="h-4 w-4" /> QR de reserva
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Imprimilo o compartilo digitalmente para que tus clientes accedan al portal.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div ref={qrRef} className="p-3 bg-white rounded-lg border border-border inline-block">
                      {publicUrl && (
                        <QRCodeCanvas
                          value={publicUrl}
                          size={140}
                          includeMargin={false}
                          aria-label={`Código QR del portal de ${orgName}`}
                        />
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleDownloadQR}>
                      <Download className="h-4 w-4 mr-1" /> Descargar QR
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Vista previa */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Vista previa</h3>
            <PortalPreview
              orgName={orgName}
              fallbackLogo={organization?.logo_url || null}
              portal={previewPortal}
              emptyMessage={hasServices ? undefined : 'No hay servicios disponibles para reservar en este momento.'}
            />
            <p className="text-xs text-muted-foreground text-center">
              Se actualiza en vivo. Los cambios se aplican al portal público al guardar.
            </p>
          </div>
        </section>

        {/* === Columna única de Cards — alineada con la columna de
             Compartir de arriba (1152 - 24 de gap - 360 de preview = 768). === */}
        <div className="max-w-3xl space-y-6">
          {/* 1 — Logo y portada: SIN modo edición, autosave intacto (Opción
              C). Sus 5 campos viven en el useState<PortalMedia> del padre
              (media/setMedia) — ya no hay <form>/useForm legacy envolviendo
              esta Card (Fase 13, cerrada). */}
          <Card id="portal-logo-portada" className="scroll-mt-16">
            <CardHeader className="pb-0">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <ImageIcon className="h-4 w-4 text-primary" />
                </span>
                <h2 className="text-sm font-semibold">Logo y portada</h2>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <SegmentedControl
                options={[
                  { value: 'logo', label: 'Logo' },
                  { value: 'portada', label: 'Portada' },
                ]}
                value={mediaTab}
                onChange={(v) => setMediaTab(v as 'logo' | 'portada')}
              />

              {mediaTab === 'portada' && (
                <div role="tabpanel" aria-label="Foto de portada" className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" /> Foto de portada{' '}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </h3>
                  <PortalCoverUploader
                    coverUrl={coverUrl}
                    coverPositionX={watchedCoverPosX}
                    coverPositionY={watchedCoverPosY}
                    coverZoom={watchedCoverZoom}
                    uploading={uploadingCover}
                    removing={removingCover}
                    disabled={removingCover || saving}
                    onUpload={handleCoverFile}
                    onRemove={handleRemoveCover}
                    onAdjust={() => setAdjustOpen(true)}
                  />
                </div>
              )}

              {mediaTab === 'logo' && (
                <div role="tabpanel" aria-label="Logo" className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <UserRound className="h-4 w-4" /> Logo{' '}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="h-16 w-16 rounded-full overflow-hidden bg-muted border border-border flex items-center justify-center shrink-0">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Logo" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">
                          {orgName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleLogoFile(f);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploadingLogo || saving}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        {uploadingLogo ? 'Subiendo...' : watchedLogoPath ? 'Cambiar logo' : 'Subir logo'}
                      </Button>
                      {watchedLogoPath && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRemoveLogo}
                          disabled={removingLogo || saving}
                          aria-label="Quitar logo"
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> {removingLogo ? 'Quitando...' : 'Quitar'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {!watchedLogoPath && (
                    <p className="text-xs text-muted-foreground">PNG, JPG o WEBP. Máximo 1 MB.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2 — Nombre y color */}
          <Card id="portal-nombre-color" className="scroll-mt-16">
            <CardHeader className="pb-0">
              <EditableSectionHeader
                title={
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Palette className="h-4 w-4 text-primary" />
                    </span>
                    <span className="text-sm font-semibold truncate">Nombre y color</span>
                  </span>
                }
                isEditing={editing === 'nombreColor'}
                saving={nombreColorSubmitting}
                disabled={editing !== null}
                onEdit={startEditingNombreColor}
                onCancel={cancelEditNombreColor}
                onSave={handleSaveNombreColor}
              />
            </CardHeader>
            <CardContent>
              {editing === 'nombreColor' ? (
                <Form {...nombreColorForm}>
                  <div className="space-y-4">
                    {/* Nombre */}
                    <FormField
                      control={nombreColorForm.control}
                      name="orgName"
                      render={({ field }) => (
                        <FormItem>
                          <div className="space-y-1">
                            <FormLabel className="flex items-center gap-2">
                              <Globe className="h-4 w-4" /> Nombre del negocio
                            </FormLabel>
                            <FormDescription className="text-xs">
                              Este es el nombre de tu negocio en toda la aplicación — no solo en el portal.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Input
                              {...field}
                              maxLength={80}
                              placeholder="Mi Barbería"
                              className="sm:max-w-sm"
                              disabled={nombreColorSubmitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Color principal */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium flex items-center gap-2">
                          <Palette className="h-4 w-4" /> Color principal{' '}
                          <span className="text-muted-foreground font-normal">(opcional)</span>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Se aplica a botones y elementos destacados del portal.
                        </p>
                      </div>

                      <PortalColorPalette value={nombreColorPrimaryColorWatch} onChange={handleColorPreset} />

                      <Collapsible open={customColorOpen} onOpenChange={setCustomColorOpen}>
                        <CollapsibleTrigger asChild>
                          <Button type="button" variant="ghost" size="sm" className="px-2 h-8 text-xs text-muted-foreground hover:text-foreground">
                            <ChevronDown className={cn('h-3.5 w-3.5 mr-1 transition-transform', customColorOpen && 'rotate-180')} />
                            Usar color personalizado
                          </Button>
                        </CollapsibleTrigger>
                        <FormField
                          control={nombreColorForm.control}
                          name="primaryColor"
                          render={() => (
                            <FormItem>
                              <CollapsibleContent className="pt-3 space-y-2">
                                <FormLabel className="sr-only">Color personalizado en formato hexadecimal</FormLabel>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="color"
                                    value={isValidHex(nombreColorPrimaryColorWatch) ? nombreColorPrimaryColorWatch : '#000000'}
                                    onChange={(e) => nombreColorForm.setValue('primaryColor', e.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })}
                                    disabled={nombreColorSubmitting}
                                    className="h-9 w-14 rounded border border-border cursor-pointer bg-transparent"
                                    aria-label="Elegir color personalizado con el selector"
                                  />
                                  <FormControl>
                                    <Input
                                      value={nombreColorPrimaryColorWatch}
                                      onChange={(e) => nombreColorForm.setValue('primaryColor', e.target.value, { shouldDirty: true, shouldValidate: true })}
                                      placeholder="#000000"
                                      maxLength={7}
                                      disabled={nombreColorSubmitting}
                                      className="font-mono w-32"
                                    />
                                  </FormControl>
                                  {nombreColorPrimaryColorWatch && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => nombreColorForm.setValue('primaryColor', '', { shouldDirty: true, shouldValidate: true })}
                                      disabled={nombreColorSubmitting}
                                      aria-label="Quitar color personalizado"
                                    >
                                      Quitar
                                    </Button>
                                  )}
                                </div>
                                <FormMessage />
                              </CollapsibleContent>
                            </FormItem>
                          )}
                        />
                      </Collapsible>
                    </div>
                  </div>
                </Form>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <Globe className="h-4 w-4" /> Nombre del negocio
                    </span>
                    <span className="block text-sm">{organization?.name || 'Mi Barbería'}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <Palette className="h-4 w-4" /> Color principal{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                    </span>
                    {config?.primary_color ? (
                      <div className="flex items-center gap-2">
                        <span
                          className="h-6 w-6 rounded-full border border-border shrink-0"
                          style={{ backgroundColor: config.primary_color }}
                        />
                        <span className="font-mono text-sm">{config.primary_color}</span>
                      </div>
                    ) : (
                      <span className="block text-sm text-muted-foreground italic">—</span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3 — Contenido del portal */}
          <Card id="portal-contenido" className="scroll-mt-16">
            <CardHeader className="pb-0">
              <EditableSectionHeader
                title={
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Type className="h-4 w-4 text-primary" />
                    </span>
                    <span className="text-sm font-semibold truncate">Contenido del portal</span>
                  </span>
                }
                isEditing={editing === 'contenido'}
                saving={contenidoSubmitting}
                disabled={editing !== null}
                onEdit={startEditingContenido}
                onCancel={cancelEditContenido}
                onSave={handleSaveContenido}
              />
            </CardHeader>
            <CardContent>
              {editing === 'contenido' ? (
                <Form {...contenidoForm}>
                  <div className="space-y-6">
                    {/* Descripción corta */}
                    <FormField
                      control={contenidoForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <div className="space-y-1">
                            <FormLabel className="flex items-center gap-2">
                              <Type className="h-4 w-4" /> Descripción corta{' '}
                              <span className="text-muted-foreground font-normal">(opcional)</span>
                            </FormLabel>
                            <FormDescription className="text-xs">
                              Si la dejás vacía, mostramos un mensaje de bienvenida automático.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Textarea
                              {...field}
                              maxLength={240}
                              rows={3}
                              placeholder={descPlaceholder}
                              disabled={contenidoSubmitting}
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground text-right">{field.value.length}/240</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Links personalizados */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium flex items-center gap-2">
                          <LinkIcon className="h-4 w-4" /> Links personalizados{' '}
                          <span className="text-muted-foreground font-normal">(opcional)</span>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Hasta 4 accesos directos (Instagram, WhatsApp, ubicación, etc.).
                        </p>
                      </div>
                      <PortalLinksEditor links={(contenidoLinksWatch ?? []) as PortalLink[]} onChange={handleLinksChange} />
                      {linksArrayMessage && (
                        <p className="text-xs text-destructive">{linksArrayMessage}</p>
                      )}
                      {Array.isArray(linkErrors) && linkErrors.map((err, idx) => {
                        const msg = err?.label?.message || err?.url?.message || err?.icon?.message;
                        return msg ? (
                          <p key={idx} className="text-xs text-destructive">Link {idx + 1}: {msg}</p>
                        ) : null;
                      })}
                    </div>
                  </div>
                </Form>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <Type className="h-4 w-4" /> Descripción corta{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                    </span>
                    <span className={cn('block text-sm whitespace-pre-wrap', config?.description ? '' : 'text-muted-foreground italic')}>
                      {config?.description || '—'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <LinkIcon className="h-4 w-4" /> Links personalizados{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                    </span>
                    {config?.links && config.links.length > 0 ? (
                      <ul className="space-y-1.5">
                        {[...config.links].sort((a, b) => a.sort_order - b.sort_order).map((l, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm">
                            <span className={l.active ? '' : 'text-muted-foreground line-through'}>{l.label || '(sin etiqueta)'}</span>
                            <span className="text-xs text-muted-foreground truncate">{l.url}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="block text-sm text-muted-foreground italic">—</span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4 — Integraciones (Fase 9, retrofit a <Card> para consistencia
              con las 3 secciones nuevas) */}
          <Card id="portal-integraciones" className="scroll-mt-16">
            <CardHeader className="pb-0">
              <EditableSectionHeader
                title={
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <BarChart3 className="h-4 w-4 text-primary" />
                    </span>
                    <span className="text-sm font-semibold truncate">Integraciones</span>
                  </span>
                }
                isEditing={editing === 'integraciones'}
                saving={integracionesSubmitting}
                disabled={editing !== null}
                onEdit={startEditingIntegraciones}
                onCancel={cancelEditIntegraciones}
                onSave={handleSaveIntegraciones}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {editing === 'integraciones' ? (
                <Form {...integracionesForm}>
                  <FormField
                    control={integracionesForm.control}
                    name="metaPixelId"
                    render={({ field }) => (
                      <FormItem>
                        <div className="space-y-1">
                          <FormLabel className="flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" /> ID de píxel de Meta{' '}
                            <span className="text-muted-foreground font-normal">(opcional)</span>
                          </FormLabel>
                          <FormDescription className="text-xs">
                            Medí las conversiones de tus campañas de Instagram y Facebook Ads a partir de las reservas del portal.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Input
                            {...field}
                            maxLength={20}
                            inputMode="numeric"
                            placeholder="1234567890123456"
                            className="font-mono sm:max-w-xs"
                            disabled={integracionesSubmitting}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Form>
              ) : (
                <div className="space-y-1">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <BarChart3 className="h-4 w-4" /> ID de píxel de Meta{' '}
                    <span className="text-muted-foreground font-normal">(opcional)</span>
                  </span>
                  <span className={cn('block font-mono text-sm', config?.meta_pixel_id ? '' : 'text-muted-foreground italic')}>
                    {config?.meta_pixel_id || '—'}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <span>
                  Para conseguir el ID: entrá a Meta Business Manager → Events Manager → seleccioná tu
                  píxel (o creá uno nuevo) → copiá el número que aparece como ID del píxel.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <PortalCoverPositionDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        coverUrl={coverUrl}
        logoUrl={logoUrl || organization?.logo_url || null}
        orgName={orgName}
        initialX={watchedCoverPosX}
        initialY={watchedCoverPosY}
        initialZoom={watchedCoverZoom}
        saving={saving}
        onSave={handleSaveCoverPosition}
      />
    </>
  );
}
