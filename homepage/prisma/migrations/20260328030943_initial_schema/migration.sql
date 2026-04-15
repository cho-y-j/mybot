-- CreateTable
CREATE TABLE "super_admins" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'basic',
    "plan_started_at" TIMESTAMP(3),
    "plan_expires_at" TIMESTAMP(3),
    "template_type" VARCHAR(30) NOT NULL DEFAULT 'election',
    "template_theme" VARCHAR(30) NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "ga_measurement_id" VARCHAR(30),
    "custom_domain" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "user_type" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "og_title" VARCHAR(200),
    "og_description" TEXT,
    "og_image_url" TEXT,
    "hero_image_url" TEXT,
    "hero_slogan" VARCHAR(200),
    "hero_sub_slogan" VARCHAR(300),
    "party_name" VARCHAR(50),
    "position_title" VARCHAR(100),
    "subtitle" VARCHAR(200),
    "intro_text" TEXT,
    "primary_color" VARCHAR(7) NOT NULL DEFAULT '#C9151E',
    "accent_color" VARCHAR(7) NOT NULL DEFAULT '#1A56DB',
    "election_date" DATE,
    "election_name" VARCHAR(100),
    "kakao_app_key" VARCHAR(100),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pledges" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "icon" VARCHAR(50) NOT NULL DEFAULT 'fas fa-bullhorn',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "details" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pledges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" VARCHAR(200),
    "category" VARCHAR(30) NOT NULL DEFAULT 'activity',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "date" DATE NOT NULL,
    "time" VARCHAR(10),
    "location" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "label" VARCHAR(50),
    "value" VARCHAR(200) NOT NULL,
    "url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "source" VARCHAR(100),
    "url" TEXT,
    "image_url" TEXT,
    "published_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "video_id" VARCHAR(20) NOT NULL,
    "title" VARCHAR(300),
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "visitor_ip" VARCHAR(45),
    "user_agent" TEXT,
    "referrer" TEXT,
    "page_path" VARCHAR(200),
    "country" VARCHAR(5),
    "device_type" VARCHAR(20),
    "visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_daily_stats" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "total_visits" INTEGER NOT NULL DEFAULT 0,
    "unique_visitors" INTEGER NOT NULL DEFAULT 0,
    "mobile_visits" INTEGER NOT NULL DEFAULT 0,
    "desktop_visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "visit_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "event_data" JSONB,
    "visitor_ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_daily_stats" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_channels" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(200),
    "channel_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_snapshots" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "subscribers" INTEGER,
    "total_views" INTEGER,
    "total_posts" INTEGER,
    "extra_data" JSONB,

    CONSTRAINT "channel_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "report_type" VARCHAR(20) NOT NULL DEFAULT 'weekly',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "content_html" TEXT,
    "pdf_path" TEXT,
    "key_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "original_name" VARCHAR(300),
    "stored_path" TEXT NOT NULL,
    "file_type" VARCHAR(20),
    "mime_type" VARCHAR(100),
    "file_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "user_type" VARCHAR(20),
    "action" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" INTEGER,
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "super_admins_username_key" ON "super_admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_user_id_key" ON "site_settings"("user_id");

-- CreateIndex
CREATE INDEX "profiles_user_id_idx" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "pledges_user_id_idx" ON "pledges"("user_id");

-- CreateIndex
CREATE INDEX "gallery_user_id_idx" ON "gallery"("user_id");

-- CreateIndex
CREATE INDEX "schedules_user_id_idx" ON "schedules"("user_id");

-- CreateIndex
CREATE INDEX "contacts_user_id_idx" ON "contacts"("user_id");

-- CreateIndex
CREATE INDEX "news_user_id_idx" ON "news"("user_id");

-- CreateIndex
CREATE INDEX "videos_user_id_idx" ON "videos"("user_id");

-- CreateIndex
CREATE INDEX "visits_user_id_visited_at_idx" ON "visits"("user_id", "visited_at");

-- CreateIndex
CREATE UNIQUE INDEX "visit_daily_stats_user_id_date_key" ON "visit_daily_stats"("user_id", "date");

-- CreateIndex
CREATE INDEX "events_user_id_created_at_idx" ON "events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_daily_stats_user_id_date_event_type_key" ON "event_daily_stats"("user_id", "date", "event_type");

-- CreateIndex
CREATE INDEX "external_channels_user_id_idx" ON "external_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_snapshots_channel_id_date_key" ON "channel_snapshots"("channel_id", "date");

-- CreateIndex
CREATE INDEX "reports_user_id_idx" ON "reports"("user_id");

-- CreateIndex
CREATE INDEX "files_user_id_idx" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery" ADD CONSTRAINT "gallery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_daily_stats" ADD CONSTRAINT "visit_daily_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_daily_stats" ADD CONSTRAINT "event_daily_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_channels" ADD CONSTRAINT "external_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_snapshots" ADD CONSTRAINT "channel_snapshots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "external_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
