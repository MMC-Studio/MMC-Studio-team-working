CREATE TABLE `conversation_extra_dirs` (
	`conversation_id` text NOT NULL,
	`path` text NOT NULL,
	`write` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`conversation_id`, `path`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
