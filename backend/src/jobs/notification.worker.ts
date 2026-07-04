import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { notifications } from '../db/schema/index.js';
import type { NotificationData } from '../db/schema/notifications.js';
import { emitNotification } from '../websocket/events.js';
import { logger } from '../lib/logger.js';
import type { NotificationJobData } from './index.js';

export async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { householdId, userId, title, message, type, data } = job.data;

  const log = logger.child({ jobId: job.id, householdId, type });
  log.debug('Processing notification job');

  try {
    // Create notification in database. The queue payload calls the text
    // "message"; the column is "body".
    const [notification] = await db
      .insert(notifications)
      .values({
        householdId,
        userId: userId || null,
        type: mapNotificationType(type),
        title,
        body: message,
        data: (data as NotificationData) || {},
      })
      .returning();

    // Emit real-time notification (shape matches the REST list payload)
    emitNotification(householdId, userId || null, {
      notificationId: notification.id,
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
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

type NotificationTypeValue = (typeof notifications.type.enumValues)[number];

// The queue's notification types line up with the DB enum one-to-one, except
// the queue's catch-all "custom", which maps to the enum's "general".
function mapNotificationType(type: NotificationJobData['type']): NotificationTypeValue {
  switch (type) {
    case 'low_stock':
    case 'expiring_soon':
    case 'leftover_expiring':
    case 'task_due':
    case 'sync_error':
      return type;
    case 'custom':
    default:
      return 'general';
  }
}
