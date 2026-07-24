-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "savedAddressId" TEXT;

-- CreateTable
CREATE TABLE "saved_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "comment" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_addresses_userId_idx" ON "saved_addresses"("userId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_savedAddressId_fkey" FOREIGN KEY ("savedAddressId") REFERENCES "saved_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
