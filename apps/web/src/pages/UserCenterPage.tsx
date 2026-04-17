import { useEffect, useMemo, useState, type FormEvent } from "react"
import { api, type UserRecord, type UserStatus } from "../api"

type UserFormState = {
  username: string
  displayName: string
  password: string
  status: UserStatus
}

const emptyUserForm: UserFormState = {
  username: "",
  displayName: "",
  password: "",
  status: "active",
}

export function UserCenterPage() {
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [formState, setFormState] = useState<UserFormState>(emptyUserForm)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [resetUser, setResetUser] = useState<UserRecord | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [resetSaving, setResetSaving] = useState(false)
  const [resetError, setResetError] = useState("")
  const [actionUserId, setActionUserId] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    setError("")
    try {
      const result = await api.listUsers()
      setUsers(result.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载用户列表失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const userCount = useMemo(() => users.length, [users])

  function openCreateForm() {
    setFormMode("create")
    setEditingUserId(null)
    setFormState(emptyUserForm)
    setFormError("")
  }

  function openEditForm(user: UserRecord) {
    setFormMode("edit")
    setEditingUserId(user.id)
    setFormState({
      username: user.username,
      displayName: user.displayName,
      password: "",
      status: user.status,
    })
    setFormError("")
  }

  function closeForm() {
    setFormMode(null)
    setEditingUserId(null)
    setFormState(emptyUserForm)
    setFormError("")
  }

  function openResetPassword(user: UserRecord) {
    setResetUser(user)
    setResetPassword("")
    setResetError("")
  }

  function closeResetPassword() {
    setResetUser(null)
    setResetPassword("")
    setResetError("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const username = formState.username.trim()
    const displayName = formState.displayName.trim()
    const password = formState.password.trim()

    if (!username || !displayName) {
      setFormError("账号和昵称都不能为空")
      return
    }

    if (formMode === "create" && !password) {
      setFormError("新建用户时必须填写密码")
      return
    }

    setFormSaving(true)
    setFormError("")

    try {
      if (formMode === "create") {
        await api.createUser({
          username,
          displayName,
          password,
          status: formState.status,
        })
      } else if (editingUserId) {
        const payload: Partial<UserFormState> = {
          username,
          displayName,
          status: formState.status,
        }
        if (password) {
          payload.password = password
        }
        await api.updateUser(editingUserId, payload)
      }
      closeForm()
      await loadUsers()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存用户失败")
    } finally {
      setFormSaving(false)
    }
  }

  async function handleToggleStatus(user: UserRecord) {
    setActionUserId(user.id)
    try {
      await api.updateUser(user.id, {
        status: user.status === "active" ? "disabled" : "active",
      })
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新用户状态失败")
    } finally {
      setActionUserId(null)
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resetUser) {
      return
    }

    if (!resetPassword.trim()) {
      setResetError("请输入新密码")
      return
    }

    setResetSaving(true)
    setResetError("")

    try {
      await api.resetUserPassword(resetUser.id, { password: resetPassword.trim() })
      closeResetPassword()
      await loadUsers()
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "重置密码失败")
    } finally {
      setResetSaving(false)
    }
  }

  return (
    <div className="workspace-page user-center-page">
      <div className="topbar">
        <div>
          <div className="eyebrow">User Center</div>
          <h1>用户中心</h1>
          <p>维护登录账号、昵称、启停状态和密码。当前共 {userCount} 个用户。</p>
        </div>
        <div className="topbar-actions">
          <button className="primary-button" onClick={openCreateForm} type="button">
            新建用户
          </button>
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="section-header">
          <h2>用户列表</h2>
          <button className="ghost-button" onClick={() => void loadUsers()} type="button">
            刷新列表
          </button>
        </div>

        {loading ? (
          <div className="empty-state">正在加载用户列表...</div>
        ) : users.length === 0 ? (
          <div className="empty-state">当前没有用户，先新建一个账号吧。</div>
        ) : (
          <div className="table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>账号</th>
                  <th>昵称</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="mono-truncate" title={user.id}>{user.id}</td>
                    <td>{user.username}</td>
                    <td>{user.displayName}</td>
                    <td>
                      <span className={user.status === "active" ? "status-pill status-pill--active" : "status-pill status-pill--disabled"}>
                        {user.status === "active" ? "启用中" : "已停用"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="ghost-button" onClick={() => openEditForm(user)} type="button">
                          编辑
                        </button>
                        <button
                          className="ghost-button"
                          disabled={actionUserId === user.id}
                          onClick={() => void handleToggleStatus(user)}
                          type="button"
                        >
                          {user.status === "active" ? "停用" : "启用"}
                        </button>
                        <button className="ghost-button" onClick={() => openResetPassword(user)} type="button">
                          重置密码
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formMode ? (
        <div className="modal-backdrop" role="presentation" onClick={closeForm}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">User Form</div>
                <h2>{formMode === "create" ? "新建用户" : "编辑用户"}</h2>
              </div>
              <button className="ghost-button" onClick={closeForm} type="button">
                关闭
              </button>
            </div>
            <form className="modal-form" onSubmit={handleSubmit}>
              <div className="modal-grid">
                <label>
                  <span className="field-label">账号</span>
                  <input
                    className="input"
                    value={formState.username}
                    onChange={(event) => setFormState((current) => ({ ...current, username: event.target.value }))}
                    placeholder="请输入登录账号"
                  />
                </label>
                <label>
                  <span className="field-label">昵称</span>
                  <input
                    className="input"
                    value={formState.displayName}
                    onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="请输入显示名称"
                  />
                </label>
                <label>
                  <span className="field-label">状态</span>
                  <select
                    className="input"
                    value={formState.status}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        status: event.target.value as UserStatus,
                      }))
                    }
                  >
                    <option value="active">active - 启用</option>
                    <option value="disabled">disabled - 停用</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">
                    {formMode === "create" ? "密码" : "新密码（留空则不修改）"}
                  </span>
                  <input
                    className="input"
                    type="password"
                    value={formState.password}
                    onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
                    placeholder={formMode === "create" ? "请输入初始密码" : "如需修改请输入新密码"}
                  />
                </label>
              </div>
              {formError ? <div className="alert">{formError}</div> : null}
              <div className="modal-footer">
                <button className="ghost-button" onClick={closeForm} type="button">
                  取消
                </button>
                <button className="primary-button" disabled={formSaving} type="submit">
                  {formSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetUser ? (
        <div className="modal-backdrop" role="presentation" onClick={closeResetPassword}>
          <div className="modal-card modal-card--small" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">Reset Password</div>
                <h2>重置密码</h2>
                <p className="modal-subtitle">
                  账号 <strong>{resetUser.username}</strong>，请输入新的登录密码。
                </p>
              </div>
              <button className="ghost-button" onClick={closeResetPassword} type="button">
                关闭
              </button>
            </div>
            <form className="modal-form" onSubmit={handleResetPassword}>
              <label>
                <span className="field-label">新密码</span>
                <input
                  className="input"
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  placeholder="请输入新密码"
                />
              </label>
              {resetError ? <div className="alert">{resetError}</div> : null}
              <div className="modal-footer">
                <button className="ghost-button" onClick={closeResetPassword} type="button">
                  取消
                </button>
                <button className="primary-button" disabled={resetSaving} type="submit">
                  {resetSaving ? "提交中..." : "确认重置"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
