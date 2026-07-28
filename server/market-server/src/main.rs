use std::net::SocketAddr;

use codey_market_server::{build_router, MarketplaceServerConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "codey_market_server=info".into()),
        )
        .init();
    let config = MarketplaceServerConfig::from_environment()?;
    let address = std::env::var("CODEY_MARKET_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse::<SocketAddr>()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "CodeY marketplace server listening");
    axum::serve(listener, build_router(config)?)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
