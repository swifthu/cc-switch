//! Office Gateway 命令层（阶段 1 骨架）
//!
//! 仅暴露 1 个 ping 命令验证 invoke_handler 链路。完整 10 个 command 在
//! 阶段 2 移植（详见
//! `docs/superpowers/plans/2026-10-13-office-gateway-migration-to-4.0.md`）。

use std::sync::Arc;

use crate::office_gateway::OfficeGatewayService;

pub struct OfficeGatewayState(pub Arc<OfficeGatewayService>);

#[tauri::command]
pub fn ping_office_gateway() -> &'static str {
    "pong"
}
