CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT 'local' NOT NULL,
	`at` integer NOT NULL,
	`conversation_id` text,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`decision` text NOT NULL,
	`exit_code` integer,
	`duration_ms` integer,
	`detail` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `action_log_owner_idx` ON `action_log` (`owner`,`at`);--> statement-breakpoint
CREATE INDEX `action_log_conversation_idx` ON `action_log` (`conversation_id`);