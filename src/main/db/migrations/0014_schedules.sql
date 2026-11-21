CREATE TABLE `schedule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`status` text NOT NULL,
	`trigger` text DEFAULT 'on_time' NOT NULL,
	`reason` text,
	`detail` text,
	`missed` integer DEFAULT 0 NOT NULL,
	`conversation_id` text,
	`tool_count` integer DEFAULT 0 NOT NULL,
	`seen_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `schedule_runs_schedule_idx` ON `schedule_runs` (`schedule_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `schedule_runs_started_idx` ON `schedule_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`recurrence` text NOT NULL,
	`project_id` text,
	`grants` text NOT NULL,
	`model` text DEFAULT 'default' NOT NULL,
	`catch_up` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`skip_next` integer DEFAULT false NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `schedules_owner_idx` ON `schedules` (`owner`,`created_at`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `schedule_id` text REFERENCES schedules(id) ON DELETE SET NULL;