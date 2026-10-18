import { supabase } from '@/integrations/supabase/client';

interface SupabaseListResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

interface SupabaseSingleResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

interface SupabaseQuery<T> extends PromiseLike<SupabaseListResult<T>> {
  select(columns: string): SupabaseQuery<T>;
  eq(column: string, value: unknown): SupabaseQuery<T>;
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery<T>;
  limit(count: number): SupabaseQuery<T>;
  abortSignal(signal: AbortSignal): SupabaseQuery<T>;
  upsert(values: Record<string, unknown>, options?: { onConflict?: string }): SupabaseQuery<T>;
  maybeSingle(): Promise<SupabaseSingleResult<T>>;
  single(): Promise<SupabaseSingleResult<T>>;
}

interface UntypedSupabaseClient {
  from<T>(table: string): SupabaseQuery<T>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<SupabaseListResult<T>>;
}

export const supabaseUntyped = supabase as unknown as UntypedSupabaseClient;
