-- GTM Signal Engine — initial schema
-- Run this in Supabase Studio → SQL Editor → New query → paste → Run

-- CreateEnum
CREATE TYPE "SignalTaxonomy" AS ENUM ('INTENT', 'TRIGGER', 'AUTHORITY_ENGAGEMENT', 'TECHNOGRAPHIC');

-- CreateEnum
CREATE TYPE "SignalCategory" AS ENUM ('BRAND_SIGNAL', 'COMMUNITY_INTENT', 'COMPETITOR_SIGNAL', 'AUTHORITY_ENGAGEMENT', 'MARKET_SIGNAL');

-- CreateEnum
CREATE TYPE "BuyerProfile" AS ENUM ('CAREER_SEEKER', 'AGENCY_BUILDER', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "platform" TEXT,
    "reason" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Individual" (
    "id" TEXT NOT NULL,
    "handle" TEXT,
    "platform" TEXT,
    "name" TEXT,
    "profileUrl" TEXT,
    "buyerProfile" "BuyerProfile" NOT NULL DEFAULT 'UNKNOWN',
    "score" INTEGER NOT NULL DEFAULT 0,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "lastQualifiedAt" TIMESTAMP(3),
    "companyName" TEXT,
    "companyDomain" TEXT,
    "title" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Individual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "individualId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "SignalCategory" NOT NULL,
    "taxonomy" "SignalTaxonomy" NOT NULL,
    "weight" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "rawData" JSONB NOT NULL,
    "buyerProfile" "BuyerProfile" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_handle_key" ON "Suppression"("handle");
CREATE INDEX "Individual_score_idx" ON "Individual"("score");
CREATE INDEX "Individual_qualified_idx" ON "Individual"("qualified");
CREATE UNIQUE INDEX "Individual_handle_platform_key" ON "Individual"("handle", "platform");
CREATE INDEX "Signal_individualId_detectedAt_idx" ON "Signal"("individualId", "detectedAt");
CREATE INDEX "Signal_detectedAt_idx" ON "Signal"("detectedAt");
CREATE UNIQUE INDEX "Signal_individualId_type_source_sourceUrl_key" ON "Signal"("individualId", "type", "source", "sourceUrl");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_individualId_fkey"
    FOREIGN KEY ("individualId") REFERENCES "Individual"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
