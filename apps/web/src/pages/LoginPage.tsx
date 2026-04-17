import { useEffect, useState, type FormEvent } from "react"
import { api } from "../api"

type LoginPageProps = {
  onLoggedIn: (operator: string) => void
}

type RememberedCredentials = {
  username: string
  password: string
}

const REMEMBER_PASSWORD_KEY = "genergi.rememberPassword"

function readRememberedCredentials(): RememberedCredentials | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_PASSWORD_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<RememberedCredentials>
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") {
      return null
    }

    return { username: parsed.username, password: parsed.password }
  } catch {
    return null
  }
}

function saveRememberedCredentials(credentials: RememberedCredentials) {
  window.localStorage.setItem(REMEMBER_PASSWORD_KEY, JSON.stringify(credentials))
}

function clearRememberedCredentials() {
  window.localStorage.removeItem(REMEMBER_PASSWORD_KEY)
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [rememberPassword, setRememberPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const remembered = readRememberedCredentials()
    if (remembered) {
      setUsername(remembered.username)
      setPassword(remembered.password)
      setRememberPassword(true)
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError("")

    try {
      const result = await api.login({ username, password })
      if (rememberPassword) {
        saveRememberedCredentials({ username, password })
      } else {
        clearRememberedCredentials()
      }
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
          <label className="field-label" htmlFor="login-username">
            账号
          </label>
          <input
            id="login-username"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入管理员账号"
          />
          <label className="field-label" htmlFor="login-password">
            密码
          </label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入管理员密码"
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(e) => setRememberPassword(e.target.checked)}
            />
            <span>记住密码（仅保存在当前浏览器本地，默认关闭）</span>
          </label>
          {error ? <div className="alert">{error}</div> : null}
          <button className="primary-button login-button" disabled={submitting} type="submit">
            {submitting ? "登录中..." : "进入平台"}
          </button>
        </form>
      </div>
    </div>
  )
}
