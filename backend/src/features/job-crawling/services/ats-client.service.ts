import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { AtsEndpoint } from '../domain/ats-detectors.js';
import type { CrawledJob } from '../domain/types.js';
import {
  canonicalizeUrl,
  normalizeLocation,
  normalizeTitle,
  normalizeWhitespace,
} from '../domain/normalize.js';

interface RawLocationObject {
  name?: string;
  city?: string;
  region?: string;
  country?: string;
}

interface RawCategoriesObject {
  location?: string;
  allLocations?: string;
  commitment?: string;
  team?: string;
}

interface RawAtsJobItem {
  id?: string | number;
  title?: string;
  name?: string;
  text?: string;
  absolute_url?: string;
  hostedUrl?: string;
  applyUrl?: string;
  jobUrl?: string;
  url?: string;
  shortcode?: string;
  location?: string | RawLocationObject;
  categories?: RawCategoriesObject;
  content?: string;
  description?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

interface RawAtsPayload {
  jobs?: RawAtsJobItem[];
  results?: RawAtsJobItem[];
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html || !html.trim()) return undefined;
  try {
    const $ = cheerio.load(html);
    const text = normalizeWhitespace($.text());
    return text.slice(0, 5000) || undefined;
  } catch {
    return normalizeWhitespace(html).slice(0, 5000) || undefined;
  }
}

@Injectable()
export class AtsClientService {
  private readonly logger = new Logger(AtsClientService.name);

  async fetchJobs(
    companyId: string,
    endpoint: AtsEndpoint,
    signal?: AbortSignal,
  ): Promise<CrawledJob[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    };

    let response: Response;
    if (endpoint.type === 'ashby') {
      response = await fetch(endpoint.apiUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal,
      });
      if (!response.ok && response.status === 405) {
        response = await fetch(endpoint.apiUrl, {
          method: 'GET',
          headers,
          signal,
        });
      }
    } else {
      response = await fetch(endpoint.apiUrl, {
        method: 'GET',
        headers,
        signal,
      });
    }

    if (!response.ok) {
      throw new Error(
        `ATS API returned HTTP ${response.status} for ${endpoint.type}:${endpoint.boardToken}`,
      );
    }

    const json = (await response.json()) as unknown;
    return this.parseAtsResponse(companyId, endpoint, json);
  }

  parseAtsResponse(companyId: string, endpoint: AtsEndpoint, json: unknown): CrawledJob[] {
    switch (endpoint.type) {
      case 'greenhouse':
        return this.parseGreenhouse(companyId, endpoint, json as RawAtsPayload);
      case 'lever':
        return this.parseLever(companyId, endpoint, json as RawAtsJobItem[]);
      case 'ashby':
        return this.parseAshby(companyId, endpoint, json as RawAtsPayload);
      case 'workable':
        return this.parseWorkable(companyId, endpoint, json as RawAtsPayload);
      default:
        return [];
    }
  }

  private parseGreenhouse(
    companyId: string,
    endpoint: AtsEndpoint,
    data: RawAtsPayload | null | undefined,
  ): CrawledJob[] {
    const list: RawAtsJobItem[] = Array.isArray(data?.jobs) ? data.jobs : [];
    const jobs: CrawledJob[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = normalizeTitle(item.title || '');
      if (!title || title.length < 3) continue;

      const appUrl = item.absolute_url || `${endpoint.sourceUrl}#${item.id}`;
      let canonicalUrl = appUrl;
      try {
        canonicalUrl = canonicalizeUrl(appUrl);
      } catch {
        // Keep as-is if canonicalization fails
      }

      const locName =
        typeof item.location === 'object' && item.location !== null
          ? item.location.name
          : typeof item.location === 'string'
            ? item.location
            : undefined;

      const key = `${title.toLowerCase()}|${canonicalUrl.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const description = stripHtml(item.content);

      jobs.push({
        companyId,
        title,
        location: normalizeLocation(locName),
        applicationUrl: canonicalUrl,
        sourceUrl: endpoint.sourceUrl,
        description,
        deadline: null,
      });
    }

    return jobs.slice(0, 150);
  }

  private parseLever(
    companyId: string,
    endpoint: AtsEndpoint,
    data: RawAtsJobItem[] | null | undefined,
  ): CrawledJob[] {
    const list: RawAtsJobItem[] = Array.isArray(data) ? data : [];
    const jobs: CrawledJob[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = normalizeTitle(item.text || '');
      if (!title || title.length < 3) continue;

      const appUrl = item.hostedUrl || item.applyUrl || `${endpoint.sourceUrl}#${item.id}`;
      let canonicalUrl = appUrl;
      try {
        canonicalUrl = canonicalizeUrl(appUrl);
      } catch {
        // Keep as-is
      }

      const locName =
        typeof item.categories?.location === 'string'
          ? item.categories.location
          : typeof item.categories?.allLocations === 'string'
            ? item.categories.allLocations
            : undefined;

      const key = `${title.toLowerCase()}|${canonicalUrl.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const description =
        typeof item.descriptionPlain === 'string' && item.descriptionPlain.trim()
          ? normalizeWhitespace(item.descriptionPlain).slice(0, 5000)
          : stripHtml(item.description);

      jobs.push({
        companyId,
        title,
        location: normalizeLocation(locName),
        applicationUrl: canonicalUrl,
        sourceUrl: endpoint.sourceUrl,
        description,
        deadline: null,
      });
    }

    return jobs.slice(0, 150);
  }

  private parseAshby(
    companyId: string,
    endpoint: AtsEndpoint,
    data: RawAtsPayload | null | undefined,
  ): CrawledJob[] {
    const list: RawAtsJobItem[] = Array.isArray(data?.jobs) ? data.jobs : [];
    const jobs: CrawledJob[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = normalizeTitle(item.title || '');
      if (!title || title.length < 3) continue;

      const appUrl = item.jobUrl || `${endpoint.sourceUrl}#${item.id}`;
      let canonicalUrl = appUrl;
      try {
        canonicalUrl = canonicalizeUrl(appUrl);
      } catch {
        // Keep as-is
      }

      const locName = typeof item.location === 'string' ? item.location : undefined;
      const key = `${title.toLowerCase()}|${canonicalUrl.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const description =
        typeof item.descriptionPlain === 'string' && item.descriptionPlain.trim()
          ? normalizeWhitespace(item.descriptionPlain).slice(0, 5000)
          : stripHtml(item.descriptionHtml);

      jobs.push({
        companyId,
        title,
        location: normalizeLocation(locName),
        applicationUrl: canonicalUrl,
        sourceUrl: endpoint.sourceUrl,
        description,
        deadline: null,
      });
    }

    return jobs.slice(0, 150);
  }

  private parseWorkable(
    companyId: string,
    endpoint: AtsEndpoint,
    data: RawAtsPayload | null | undefined,
  ): CrawledJob[] {
    const list: RawAtsJobItem[] = Array.isArray(data?.results) ? data.results : [];
    const jobs: CrawledJob[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = normalizeTitle(item.title || '');
      if (!title || title.length < 3) continue;

      const appUrl = item.url || `${endpoint.sourceUrl}#${item.shortcode || item.id}`;
      let canonicalUrl = appUrl;
      try {
        canonicalUrl = canonicalizeUrl(appUrl);
      } catch {
        // Keep as-is
      }

      let locName: string | undefined;
      if (item.location && typeof item.location === 'object') {
        const parts = [item.location.city, item.location.region, item.location.country].filter(
          Boolean,
        );
        if (parts.length) locName = parts.join(', ');
      }

      const key = `${title.toLowerCase()}|${canonicalUrl.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const description = stripHtml(item.description);

      jobs.push({
        companyId,
        title,
        location: normalizeLocation(locName),
        applicationUrl: canonicalUrl,
        sourceUrl: endpoint.sourceUrl,
        description,
        deadline: null,
      });
    }

    return jobs.slice(0, 150);
  }
}
