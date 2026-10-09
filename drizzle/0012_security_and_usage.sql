CREATE TABLE `admin_roles` (
	`userId` int NOT NULL,
	`role` enum('super_admin','editor','support','viewer') NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_roles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`userAgent` varchar(255),
	`ip` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_idx` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` varchar(10) NOT NULL,
	`city` varchar(96) NOT NULL,
	`event` varchar(32) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	CONSTRAINT `usage_daily_day_city_event_pk` PRIMARY KEY(`day`,`city`,`event`)
);
--> statement-breakpoint
ALTER TABLE `verification_codes` MODIFY COLUMN `purpose` enum('register','password_reset','admin_login') NOT NULL;--> statement-breakpoint
CREATE INDEX `admin_sessions_user_idx` ON `admin_sessions` (`userId`);