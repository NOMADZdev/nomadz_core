import { execSync } from "child_process";

describe("Testing Pipeline", () => {
  it("Runs all tests in sequence", () => {
    // uncomment required test file
    const testFiles = [
      // config tests
      // "config/initialize.test.ts",
      // "config/update.test.ts",

      //referral
      // "referral/apply_referral.test.ts",
      // "referral/update_user.test.ts",

      // config tests
      // "soulbound/mint.test.ts",
      "soulbound/update.test.ts",
    ];

    for (const testFile of testFiles) {
      console.log(`Running ${testFile}...`);
      execSync(
        `yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/cases/${testFile}`,
        {
          stdio: "inherit",
        },
      );
    }
  });
});
