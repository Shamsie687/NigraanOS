import { createClient } from "@supabase/supabase-js";
import { SafeError } from "./errors.js";
export interface IncidentRow {
  id: string;
  category: string;
  status: string;
  priority: string;
  reported_at: string;
  submission_state: string;
}
export interface ActivityRow {
  id: string;
  incident_id: string;
  kind: "edit" | "update";
  published_at: string;
}
export interface Caller {
  authorize(expectedId?: string, signal?: AbortSignal): Promise<string>;
  incidents(
    offset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<IncidentRow[]>;
  incident(id: string, signal: AbortSignal): Promise<IncidentRow | null>;
  activity(
    ids: string[],
    from: number,
    to: number,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ActivityRow[]>;
  conditions(signal: AbortSignal): Promise<unknown>;
}
export type CallerFactory = (accessToken: string) => Caller;
export function supabaseFactory(
  url: string,
  key: string,
  fetcher: typeof fetch = fetch,
): CallerFactory {
  return (accessToken) => {
    const boundedFetch: typeof fetch = (input, init) =>
      fetcher(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(10000),
        ]),
      });
    const client = createClient(url, key, {
      global: {
        fetch: boundedFetch,
        headers: { Authorization: "Bearer " + accessToken },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return {
      async authorize(expectedId, signal) {
        const { data, error } = await client.auth.getUser(accessToken);
        if (error || !data.user || (expectedId && data.user.id !== expectedId))
          throw new SafeError("invalid_token", 401);
        if (signal?.aborted) throw new SafeError("timeout", 504);
        let q = client.rpc("is_approved_operations");
        if (signal) q = q.abortSignal(signal);
        const approval = await q;
        if (approval.error) throw new SafeError("read_unavailable", 503);
        if (approval.data !== true) throw new SafeError("access_denied", 403);
        return data.user.id;
      },
      async incidents(offset, limit, signal) {
        const r = await client
          .from("incidents")
          .select("id,category,status,priority,reported_at,submission_state")
          .eq("submission_state", "submitted")
          .order("reported_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1)
          .abortSignal(signal);
        if (r.error || !Array.isArray(r.data))
          throw new SafeError("read_unavailable", 503);
        return r.data as IncidentRow[];
      },
      async incident(id, signal) {
        const r = await client
          .from("incidents")
          .select("id,category,status,priority,reported_at,submission_state")
          .eq("id", id)
          .eq("submission_state", "submitted")
          .abortSignal(signal)
          .maybeSingle();
        if (r.error) throw new SafeError("read_unavailable", 503);
        return r.data as IncidentRow | null;
      },
      async activity(ids, from, to, offset, limit, signal) {
        const r = await client
          .from("nigraan_citizen_changes")
          .select("id,incident_id,kind,published_at")
          .eq("submission_state", "published")
          .in("incident_id", ids)
          .gte("published_at", new Date(from).toISOString())
          .lt("published_at", new Date(to).toISOString())
          .order("published_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + limit - 1)
          .abortSignal(signal);
        if (r.error || !Array.isArray(r.data))
          throw new SafeError("read_unavailable", 503);
        return r.data as ActivityRow[];
      },
      async conditions(signal) {
        const r = await client.functions.invoke("city-context", {
          body: { city_id: "karachi" },
          signal,
        });
        if (
          r.error ||
          r.data?.version !== 1 ||
          r.data.context_only !== true ||
          r.data.city?.id !== "karachi" ||
          !r.data.weather ||
          !r.data.air_quality
        )
          throw new SafeError("read_unavailable", 503);
        return r.data;
      },
    };
  };
}
