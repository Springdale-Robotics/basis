import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { notifications } from '../db/schema/index.js';
import { emitNotification } from '../websocket/events.js';
import { logger } from '../lib/logger.js';
import type { NotificationJobData } from './index.js';

export async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { householdId, userId, title, message, type, data } = job.data;

  const log = logger.child({ jobId: job.id, householdId, type });
  log.debug('Processing notification job');

  try {
    // Create notification in database
    const [notification] = await db
      .insert(notifications)
      .values({
        householdId,
        userId: userId || null,
        type: mapNotificationType(type),
        title,
        message,
        data: data || {},
      })
      .returning();

    // Emit real-time notification
    emitNotification(householdId, userId || null, {
      notificationId: notification.id,
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        createdAt: notification.createdAt,
      },
    });

    log.debug({ notificationId: notification.id }, 'Notification created and emitted');
  } catch (error) {
    log.error({ error }, 'Failed to process notification job');
    throw error;
  }
}

function mapNotificationType(type: NotificationJobData['type']): string {
  switch (type) {
    case 'low_stock':
      return 'inventory_low_stock';
    case 'expiring_soon':
      return 'inventory_expiring';
    case 'task_due':
      return 'task_due';
    case 'sync_error':
      return 'sync_error';
    case 'custom':
    default:
      return 'info';
  }
}
