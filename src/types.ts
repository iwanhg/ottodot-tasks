export type BookingStatus = "draft" | "pending_payment" | "confirmed" | "payment_failed" | "cancelled";

export interface Parent {
  id: number;
  name: string;
  email: string;
}

export interface Student {
  id: number;
  parent_id: number;
  name: string;
}

export interface TrialClass {
  id: number;
  subject: string;
  starts_at: string;
  capacity: number;
  seats_taken: number;
}

export interface Booking {
  id: number;
  student_id: number;
  trial_class_id: number;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
}

export interface PaymentAttempt {
  id: number;
  booking_id: number;
  success: boolean;
  created_at: string;
}
