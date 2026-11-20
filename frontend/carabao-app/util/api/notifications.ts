import { apiClient } from './client';

// In-app notifications (U5). The backend scopes every call to the signed-in user.
// `audience` splits an account that is both buyer and farm owner: the buyer
// site asks for "buyer" (buyer + admin notices), the merchant site for "merchant".

export type NotificationAudience = 'buyer' | 'merchant';

export type AppNotification = {
  id: number;
  kind: string;
  audience: string;
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
  params: { limit?: number; offset?: number; unreadOnly?: boolean; audience: NotificationAudience }
): Promise<NotificationPage> => {
  const res = await apiClient.get<NotificationPage>('/users/me/notifications', {
    params: {
      limit: params.limit ?? 30,
      offset: params.offset ?? 0,
      unread_only: params.unreadOnly ?? false,
      audience: params.audience,
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

export const markAllNotificationsRead = async (audience: NotificationAudience): Promise<void> => {
  await apiClient.post('/users/me/notifications/read-all', null, { params: { audience } });
};

export const deleteNotification = async (id: number): Promise<void> => {
  await apiClient.delete(`/users/me/notifications/${id}`);
};

/** Delete every notification the user has already read. */
export const deleteReadNotifications = async (audience: NotificationAudience): Promise<void> => {
  await apiClient.delete('/users/me/notifications/read', { params: { audience } });
};
