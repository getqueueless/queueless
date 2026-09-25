create type public.user_role as enum ('patient', 'staff', 'admin');
create type public.lane as enum ('emergency', 'senior', 'pregnant', 'appointment', 'normal');
create type public.token_status as enum ('waiting', 'called', 'serving', 'done', 'skipped', 'no_show', 'cancelled');
create type public.counter_state as enum ('open', 'paused', 'closed');
create type public.appointment_status as enum ('booked', 'checked_in', 'cancelled', 'no_show');
