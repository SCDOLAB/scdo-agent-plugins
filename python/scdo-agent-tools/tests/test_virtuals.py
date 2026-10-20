import pytest
pytest.importorskip("game_sdk")
from test_core import mk  # noqa: E402
from scdo_agent_tools.virtuals import ScdoWalletPlugin  # noqa: E402


def test_game_functions(tmp_path):
    p = ScdoWalletPlugin(bot="Game Bot", agent=mk(tmp_path))
    fns = {f.fn_name: f for f in p.get_functions()}
    assert set(fns) == {"scdo_register_agent", "scdo_create_wallet", "scdo_get_balance", "scdo_pay_x402", "scdo_book_income"}
    r = fns["scdo_register_agent"].execute(fn_id="1", args={})
    assert r.action_status.value == "done", r.feedback_message
    assert r.info["wallet"].startswith("0x")
    assert p.get_state()["scdo_wallet"] == r.info["wallet"]
    bad = fns["scdo_pay_x402"].execute(fn_id="2", args={"url": {"value": "https://x.example/p"}, "max_usdc": {"value": "5"}})
    assert bad.action_status.value == "failed"
    w = p.get_worker()
    assert len(w.action_space) == 5 if hasattr(w, "action_space") else True
