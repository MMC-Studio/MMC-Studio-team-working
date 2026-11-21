CREATE TABLE `deferred_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text DEFAULT 'local' NOT NULL,
	`conversation_id` text NOT NULL,
	`schedule_id` text,
	`run_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`qa` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deferred_owner_idx` ON `deferred_approvals` (`owner`,`status`);--> statement-breakpoint
CREATE INDEX `deferred_conversation_idx` ON `deferred_approvals` (`conversation_id`);