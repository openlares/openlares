CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`filename` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text,
	`size` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_task` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE TABLE `project_agents` (
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `agent_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_agents_project` ON `project_agents` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`config` text,
	`pinned` integer DEFAULT false NOT NULL,
	`last_accessed_at` integer,
	`system_prompt` text,
	`session_mode` text DEFAULT 'per-task' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `queue_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`queues_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `queues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_type` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`agent_limit` integer DEFAULT 1 NOT NULL,
	`system_prompt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_queues_project` ON `queues` (`project_id`);--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author` text NOT NULL,
	`author_type` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_comments_task` ON `task_comments` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`from_queue_id` text,
	`to_queue_id` text,
	`actor` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_history_task` ON `task_history` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`queue_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`session_key` text,
	`assigned_agent` text,
	`error` text,
	`error_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`queue_id`) REFERENCES `queues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_queue` ON `tasks` (`queue_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE TABLE `transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`from_queue_id` text NOT NULL,
	`to_queue_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`conditions` text,
	`auto_trigger` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_queue_id`) REFERENCES `queues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_queue_id`) REFERENCES `queues`(`id`) ON UPDATE no action ON DELETE cascade
);
