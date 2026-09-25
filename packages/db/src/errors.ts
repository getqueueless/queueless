export type ErrorCode =
  | "not_signed_in"
  | "forbidden"
  | "service_closed"
  | "slot_closed"
  | "queue_full"
  | "already_active"
  | "already_booked"
  | "busy"
  | "rate_limited"
  | "cooldown"
  | "lane_not_allowed"
  | "slot_full"
  | "checkin_window"
  | "counter_busy"
  | "counter_closed"
  | "illegal_transition"
  | "not_found"
  | "profile_incomplete"
  | "invalid_profile"
  | "invalid_phone"
  | "invalid_date_of_birth"
  | "phone_in_use"
  | "invalid_status"
  | "invalid_language"
  | "PGRST003"
  | "PGRST202"
  | "network_error";

interface ErrorInfo {
  http: number;
  message: string;
  retryable: boolean;
}

export const ERRORS: Record<ErrorCode, ErrorInfo> = {
  not_signed_in: { http: 401, message: "Please sign in to continue", retryable: false },
  forbidden: { http: 403, message: "You don't have permission to do that", retryable: false },
  service_closed: { http: 409, message: "This service isn't open right now", retryable: false },
  slot_closed: { http: 409, message: "That slot can't be booked anymore", retryable: false },
  queue_full: { http: 409, message: "This queue is full for today", retryable: false },
  already_active: { http: 409, message: "You already have a ticket for this service", retryable: false },
  already_booked: { http: 409, message: "You already have a booking for this service", retryable: false },
  busy: { http: 429, message: "Still working on your last request", retryable: true },
  rate_limited: { http: 429, message: "Too many requests, please slow down", retryable: true },
  cooldown: { http: 403, message: "Too many cancellations today, try again tomorrow", retryable: true },
  lane_not_allowed: { http: 403, message: "That lane isn't available to you", retryable: false },
  slot_full: { http: 409, message: "That slot just filled up", retryable: false },
  checkin_window: { http: 409, message: "It's too early or too late to check in", retryable: false },
  counter_busy: { http: 409, message: "That desk is already serving someone", retryable: false },
  counter_closed: { http: 409, message: "That desk is closed", retryable: false },
  illegal_transition: { http: 409, message: "That ticket can't change state right now", retryable: false },
  not_found: { http: 404, message: "We couldn't find that", retryable: false },
  profile_incomplete: { http: 403, message: "Please finish your profile first", retryable: false },
  invalid_profile: { http: 400, message: "Fill in your name and city", retryable: false },
  invalid_phone: { http: 400, message: "Enter a 10-digit Indian mobile number", retryable: false },
  invalid_date_of_birth: { http: 400, message: "Enter a valid date of birth", retryable: false },
  phone_in_use: { http: 409, message: "That phone number is already registered", retryable: false },
  invalid_status: { http: 400, message: "That's not a valid status", retryable: false },
  invalid_language: { http: 400, message: "That language isn't supported", retryable: false },
  PGRST003: { http: 504, message: "Busy, try again", retryable: true },
  PGRST202: { http: 404, message: "Server updating, retry shortly", retryable: true },
  network_error: { http: 0, message: "Couldn't reach the server", retryable: true },
};

export function errorInfo(code: string): ErrorInfo {
  return (ERRORS as Record<string, ErrorInfo>)[code] ?? {
    http: 500,
    message: "Something went wrong",
    retryable: false,
  };
}
