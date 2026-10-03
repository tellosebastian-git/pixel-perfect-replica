import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Line } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { DerivedMonthlyMetrics, MetricCardDef, varKeyMap } from './types';

interface MetricDetailDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  metric: MetricCardDef | null;
  data: DerivedMonthlyMetrics[];
}

export function MetricDetailDialog({
  open,
  onOpenChange,
  metric,
  data,
}: MetricDetailDialogProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  if (!metric) return null;
  const config = { [metric.dataKey]: { label: metric.title, color: metric.chartColor } };
  const vKey = varKeyMap[metric.dataKey as string];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <metric.icon className={`h-5 w-5 ${metric.color}`} />
            {metric.title}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{metric.description}</p>
        </DialogHeader>

        {/* Big chart */}
        <ChartContainer config={config} className="h-64 w-full">
          <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="monthLabel" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} width={55} tickFormatter={(v) => metric.shortFormatFn(v)} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const varVal = vKey ? (item.payload as any)?.[vKey] : null;
                    const varStr = varVal != null ? ` (${varVal > 0 ? '+' : ''}${varVal.toFixed(1)}%)` : '';
                    return `${metric.formatFn(Number(value))}${varStr}`;
                  }}
                />
              }
            />
            <Bar dataKey={metric.dataKey} fill={metric.chartColor} radius={[4, 4, 0, 0]} opacity={0.6} isAnimationActive={!prefersReducedMotion} />
            <Line type="monotone" dataKey={metric.dataKey} stroke={metric.chartColor} strokeWidth={2.5} dot={{ r: 3, fill: metric.chartColor }} isAnimationActive={!prefersReducedMotion} />
          </ComposedChart>
        </ChartContainer>

        {/* Detail table */}
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                {metric.origenKeys && (
                  <>
                    <TableHead className="text-right">Manual</TableHead>
                    <TableHead className="text-right">Importado</TableHead>
                    <TableHead className="text-right">Reserva</TableHead>
                  </>
                )}
                <TableHead className="text-right">Variación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => {
                const value = row[metric.dataKey] as number;
                const variation = vKey ? (row[vKey] as number | null) : null;
                return (
                  <TableRow key={row.monthLabel}>
                    <TableCell className="font-medium">{row.monthLabel}</TableCell>
                    <TableCell className="text-right">{metric.formatFn(value)}</TableCell>
                    {metric.origenKeys && (
                      <>
                        <TableCell className="text-right text-muted-foreground">{row[metric.origenKeys.manual] as number}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{row[metric.origenKeys.importado] as number}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{row[metric.origenKeys.reserva] as number}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      {variation == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-0.5 ${variation > 0 ? 'text-status-success-foreground' : variation < 0 ? 'text-status-error-foreground' : 'text-muted-foreground'}`}>
                          {variation > 0 ? <ArrowUpRight className="h-3 w-3" /> : variation < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                          {variation > 0 ? '+' : ''}{variation.toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
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
