import { Pie, PieChart, Cell } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import type { DonutCardSlice } from './DonutCard';

interface DonutDetailDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  data: DonutCardSlice[];
  total?: number;
  formatValue?: (v: number) => string;
}

/** Vista ampliada de cualquier DonutCard: donut más grande + tabla sin truncar (nombre/monto/%). */
export function DonutDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  data,
  total,
  formatValue = (v) => `${v}`,
}: DonutDetailDialogProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const computedTotal = total ?? data.reduce((sum, d) => sum + d.value, 0);
  const config = data.reduce((acc, d) => {
    acc[d.label] = { label: d.label, color: d.color };
    return acc;
  }, {} as Record<string, { label: string; color: string }>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </DialogHeader>

        <ChartContainer config={config} className="h-64 w-64 mx-auto aspect-square">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => `${name}: ${formatValue(Number(value))}`}
                />
              }
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="55%"
              outerRadius="90%"
              paddingAngle={2}
              isAnimationActive={!prefersReducedMotion}
            >
              {data.map((slice) => (
                <Cell key={slice.label} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Porcentaje</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((slice) => {
                const pct = computedTotal > 0 ? (slice.value / computedTotal) * 100 : 0;
                return (
                  <TableRow key={slice.label}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-[2px] shrink-0" style={{ backgroundColor: slice.color }} />
                        {slice.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{formatValue(slice.value)}</TableCell>
                    <TableCell className="text-right">{pct.toFixed(0)}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
