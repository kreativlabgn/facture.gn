export interface NotificationSendResult {
  success: boolean;
}

// Même forme que PaymentProvider (money-api) — pas une coïncidence, même
// discipline de stub faute de credentials réels (voir plan
// payment-link-notifications, C9).
export interface NotificationProvider {
  send(phone: string, message: string): Promise<NotificationSendResult>;
}
