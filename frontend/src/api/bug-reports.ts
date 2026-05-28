import { apiGet, apiPost, apiDelete } from './client';
import type { ConsoleLogEntry } from '@/lib/consoleBuffer';

export type BugReportStatus = 'pending' | 'sent' | 'failed';

export interface BugReportSummary {
  id: string;
  userId: string | null;
  description: string;
  url: string;
  appVersion: string | null;
  status: BugReportStatus;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  lastError: string | null;
  attempts: number;
  createdAt: string;
  consoleLogCount: number;
  hasScreenshot: boolean;
}

export interface CreateBugReportRequest {
  description: string;
  url: string;
  userAgent?: string;
  consoleLog?: ConsoleLogEntry[];
  screenshot?: string;
  viewport?: { w: number; h: number };
}

export const bugReportsApi = {
  create: (data: CreateBugReportRequest) =>
    apiPost<{ id: string; status: BugReportStatus }>('/bug-reports', data),

  list: () =>
    apiGet<{ reports: BugReportSummary[] }>('/bug-reports'),

  retry: (id: string) =>
    apiPost<{ id: string; status: BugReportStatus }>(`/bug-reports/${id}/retry`),

  delete: (id: string) =>
    apiDelete<{ id: string }>(`/bug-reports/${id}`),
};
