import { apiClient } from './client';

// In-app notifications (U5). The backend scopes every call to the signed-in user.

export type AppNotification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export type NotificationPage = {
  items: AppNotification[];
  unread: number;
  /** Rows matching the filter (all, or unread only). */
  total: number;
};

export const fetchNotifications = async (
  params: { limit?: number; offset?: number; unreadOnly?: boolean } = {}
): Promise<NotificationPage> => {
  const res = await apiClient.get<NotificationPage>('/users/me/notifications', {
    params: {
      limit: params.limit ?? 30,
      offset: params.offset ?? 0,
      unread_only: params.unreadOnly ?? false,
    },
  });
  return res.data;
};

export const markNotificationRead = async (id: number): Promise<void> => {
  await apiClient.post(`/users/me/notifications/${id}/read`);
};

export const markNotificationUnread = async (id: number): Promise<void> => {
  await apiClient.post(`/users/me/notifications/${id}/unread`);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await apiClient.post('/users/me/notifications/read-all');
};

export const deleteNotification = async (id: number): Promise<void> => {
  await apiClient.delete(`/users/me/notifications/${id}`);
};

/** Delete every notification the user has already read. */
export const deleteReadNotifications = async (): Promise<void> => {
  await apiClient.delete('/users/me/notifications/read');
};
