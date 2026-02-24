import { GlobalSettings, ReferenceCase } from '../types';

export const CloudService = {
  async getAllReferences(settings: GlobalSettings): Promise<{ data: ReferenceCase[] | null; error: any }> {
    if (!settings.supabaseUrl || !settings.supabaseKey) {
      return { data: null, error: "Missing Supabase configuration" };
    }

    try {
      // Clean URL (remove trailing slash)
      const baseUrl = settings.supabaseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/rest/v1/references?select=*`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': settings.supabaseKey,
          'Authorization': `Bearer ${settings.supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // If 404, maybe table doesn't exist or permissions issue, return empty to avoid crash
        if (response.status === 404) return { data: [], error: null };
        const errText = await response.text();
        return { data: null, error: `Supabase Error (${response.status}): ${errText}` };
      }

      const data = await response.json();
      return { data: data as ReferenceCase[], error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  },

  async upsertReference(settings: GlobalSettings, ref: ReferenceCase): Promise<{ success: boolean; error: any }> {
    if (!settings.supabaseUrl || !settings.supabaseKey) return { success: false, error: "Missing Config" };

    try {
      const baseUrl = settings.supabaseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/rest/v1/references`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': settings.supabaseKey,
          'Authorization': `Bearer ${settings.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(ref)
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: errText };
      }

      return { success: true, error: null };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  async deleteReference(settings: GlobalSettings, id: string): Promise<{ success: boolean; error: any }> {
    if (!settings.supabaseUrl || !settings.supabaseKey) return { success: false, error: "Missing Config" };

    try {
      const baseUrl = settings.supabaseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/rest/v1/references?id=eq.${id}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': settings.supabaseKey,
          'Authorization': `Bearer ${settings.supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: errText };
      }

      return { success: true, error: null };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
};