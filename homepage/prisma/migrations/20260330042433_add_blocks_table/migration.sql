-- CreateTable
CREATE TABLE "blocks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200),
    "content" JSONB,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blocks_user_id_idx" ON "blocks"("user_id");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
