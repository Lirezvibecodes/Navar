/**
 * The web app's sign-in through the bot. The rules that keep it safe are all
 * in the code's lifecycle: nothing is handed out until the person in Telegram
 * confirms, a confirmed code is good exactly once, and a cancelled one is gone.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_CODE,
  cancelLoginCode,
  confirmLoginCode,
  createLoginCode,
  describeDevice,
  describeLoginCode,
  redeemLoginCode,
} from "../src/bot-login";

const who = { id: 42, username: "someone", first_name: "Some" };

describe("bot login codes", () => {
  test("a code fits a Telegram start payload", () => {
    const { code } = createLoginCode("Safari on iPhone");
    assert.match(code, LOGIN_CODE);
    assert.ok(`login_${code}`.length <= 64);
  });

  test("nothing is handed out until the person confirms, then exactly once", () => {
    const { code } = createLoginCode("Safari on iPhone");
    assert.equal(redeemLoginCode(code), "pending");
    assert.deepEqual(describeLoginCode(code), { device: "Safari on iPhone" });
    assert.equal(confirmLoginCode(code, who), true);
    assert.equal(confirmLoginCode(code, { id: 99 }), false, "a second confirm cannot swap the account");
    assert.deepEqual(redeemLoginCode(code), who);
    assert.equal(redeemLoginCode(code), null, "a used code is gone");
  });

  test("a cancelled code can be neither confirmed nor redeemed", () => {
    const { code } = createLoginCode("Chrome on Android");
    cancelLoginCode(code);
    assert.equal(describeLoginCode(code), null);
    assert.equal(confirmLoginCode(code, who), false);
    assert.equal(redeemLoginCode(code), null);
  });

  test("devices are named well enough to recognise", () => {
    assert.equal(
      describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"),
      "Safari on iPhone"
    );
    assert.equal(
      describeDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"),
      "Chrome on Android"
    );
  });
});
