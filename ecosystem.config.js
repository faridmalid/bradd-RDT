module.exports = {
  apps : [{
    name   : "bradd-rdt",
    script : "npm",
    args   : "start --workspace=packages/server",
    env: {
       NODE_ENV: "production",
       PORT: 3000
    }
  }]
}
