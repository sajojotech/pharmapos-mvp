import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Test integrasi berbagi SATU database Postgres dev (tidak ada isolasi
    // transaction-per-test). Menjalankan file test secara paralel membuat
    // test yang membuat/menghapus data sementara (mis. produk throwaway)
    // bisa "terlihat" oleh assertion broad di file lain yang sedang
    // berjalan bersamaan (query "semua produk milik company"), menghasilkan
    // kegagalan flaky yang tidak berkaitan dengan bug sesungguhnya.
    // Menjalankan file secara sekuensial menghilangkan seluruh kelas race
    // condition ini dengan trade-off waktu total sedikit lebih lama —
    // dapat diterima untuk skala test suite MVP ini.
    fileParallelism: false,
  },
});
