import { useState } from "react"
import { api } from "../api"

type LoginPageProps = {
  onLoggedIn: (operator: string) => void
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")

    try {
      const result = await api.login({ username, password })
      onLoggedIn(result.operator)
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="eyebrow">GENERGI Control Console</div>
        <h1>管理员登录</h1>
        <p>登录中文工作台，继续管理面向海外英语市场的视频生产任务。</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label">账号</label>
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入管理员账号" />
          <label className="field-label">密码</label>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入管理员密码" />
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button login-button" disabled={submitting} type="submit">
            {submitting ? "登录中..." : "进入平台"}
          </button>
        </form>
      </div>
    </div>
  )
}
