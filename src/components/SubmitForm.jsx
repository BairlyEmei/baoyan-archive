import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Button,
    Card,
    Divider,
    Form,
    Input,
    Modal,
    Radio,
    Space,
    Typography,
    ConfigProvider,
    theme as antdTheme,
} from 'antd';
import { Turnstile } from '@marsidev/react-turnstile';
import MarkdownIt from 'markdown-it';
import './editor-fixes.css';
import { parseAndValidateJson } from './JsonParser';
import { serializeToMarkdown, serializeToJson, deserializeFromMarkdown, toLineSeparatedText } from './MarkdownSerializer';

const DRAFT_KEY = 'baoyan-submit-draft';

const defaultValues = {
    basicInfo: {
        school: '',
        college: '',
        track: '',
        degree: '',
        length: '',
    },
    timeline: {
        website: '',
        summer: {
            publish: '',
            deadline: '',
            notices: '',
        },
        prePush: {
            publish: '',
            notices: '',
        },
        otherDocs: [{ title: '', url: '' }],
    },
    assessments: [
        {
            name: '',
            enrollment: '',
            format: '',
            writtenScope: '',
            bar: '',
            interviewPreference: '',
            experienceLinks: '',
            admissionListLinks: '',
            interviewLinks: '',
            examLinks: '',
        },
    ],
    misc: {
        notesLinks: '',
    },
};

function normalizeIncomingData(data) {
    return {
        basicInfo: {
            school: data.basicInfo?.school || '',
            college: data.basicInfo?.college || '',
            track: data.basicInfo?.track || '',
            degree: data.basicInfo?.degree || '',
            length: data.basicInfo?.length || '',
        },
        timeline: {
            website: data.timeline?.website || '',
            summer: {
                publish: data.timeline?.summer?.publish || '',
                deadline: data.timeline?.summer?.deadline || '',
                notices: toLineSeparatedText(data.timeline?.summer?.notices),
            },
            prePush: {
                publish: data.timeline?.prePush?.publish || '',
                notices: toLineSeparatedText(data.timeline?.prePush?.notices),
            },
            otherDocs:
                data.timeline?.otherDocs && data.timeline.otherDocs.length
                    ? data.timeline.otherDocs.map((doc) => ({
                        title: doc.title || '',
                        url: doc.url || '',
                    }))
                    : [{ title: '', url: '' }],
        },
        assessments:
            data.assessments && data.assessments.length
                ? data.assessments.map((item) => ({
                    name: item.name || '',
                    enrollment: item.enrollment || '',
                    format: item.format || '',
                    writtenScope: item.writtenScope || '',
                    bar: item.bar || '',
                    interviewPreference: item.interviewPreference || '',
                    experienceLinks: toLineSeparatedText(item.experienceLinks),
                    admissionListLinks: toLineSeparatedText(item.admissionListLinks),
                    interviewLinks: toLineSeparatedText(item.interviewLinks),
                    examLinks: toLineSeparatedText(item.examLinks),
                }))
                : defaultValues.assessments,
        misc: {
            notesLinks: toLineSeparatedText(data.misc?.notesLinks),
        },
    };
}

export default function SubmitForm() {
    const [form] = Form.useForm();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [rawJson, setRawJson] = useState('');
    const [parseErrors, setParseErrors] = useState([]);
    const [parseSuccess, setParseSuccess] = useState('');
    const [formValues, setFormValues] = useState(defaultValues);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [authorName, setAuthorName] = useState('');
    const [authorEmail, setAuthorEmail] = useState('');
    const [turnstileToken, setTurnstileToken] = useState('');
    const [turnstileMsg, setTurnstileMsg] = useState(null); // { type: 'error'|'warning', text: string }
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState(null); // { type: 'success'|'error'|'fallback', message, prUrl? }
    const [draftSavedAt, setDraftSavedAt] = useState(null);
    const [submissionType, setSubmissionType] = useState('new'); // 'new' | 'supplement'

    // Load draft from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(DRAFT_KEY);
            if (saved) {
                const draft = JSON.parse(saved);
                if (draft.formValues) {
                    form.setFieldsValue(draft.formValues);
                    setFormValues(draft.formValues);
                }
                if (draft.authorName) setAuthorName(draft.authorName);
                if (draft.authorEmail) setAuthorEmail(draft.authorEmail);
                if (draft.rawJson) setRawJson(draft.rawJson);
            }
        } catch {
            // ignore corrupted draft data
        }
    }, [form, setFormValues, setAuthorName, setAuthorEmail, setRawJson]);

    // Auto-save draft to localStorage (debounced 500 ms) whenever form data changes
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(DRAFT_KEY, JSON.stringify({ formValues, authorName, authorEmail, rawJson }));
                setDraftSavedAt(new Date());
            } catch {
                // ignore storage errors (e.g. private browsing quota exceeded)
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [formValues, authorName, authorEmail, rawJson]);

    function handleClearDraft() {
        try {
            localStorage.removeItem(DRAFT_KEY);
        } catch {
            // ignore
        }
        form.resetFields();
        setFormValues(defaultValues);
        setAuthorName('');
        setAuthorEmail('');
        setRawJson('');
        setDraftSavedAt(null);
        setParseErrors([]);
        setParseSuccess('');
        setSubmitResult(null);
    }

    // 静默检查当前学校/学院是否已有档案（onBlur 触发）
    const checkExistingArchive = useCallback(async () => {
        const school = form.getFieldValue(['basicInfo', 'school']);
        const college = form.getFieldValue(['basicInfo', 'college']);
        if (!school || !college) return;

        try {
            const params = new URLSearchParams({ school, college });
            const resp = await fetch(`/api/check_exists?${params}`);
            if (!resp.ok) return;
            const data = await resp.json();
            if (!data.exists || !data.content) return;

            Modal.confirm({
                title: '发现已有历史档案',
                content: '发现该学院已有历史档案。是否加载现有内容？加载后请在已有数据基础上进行补充或修正。',
                okText: '加载已有档案',
                cancelText: '保留当前内容',
                onOk() {
                    // 解析已有档案内容并填入表单
                    try {
                        // Try JSON first (future-proofing), then fall back to Markdown parsing
                        const result = parseAndValidateJson(data.content);
                        let formData = null;
                        if (result.ok) {
                            formData = result.data;
                        } else {
                            formData = deserializeFromMarkdown(data.content);
                        }
                        if (formData) {
                            const normalized = normalizeIncomingData(formData);
                            form.setFieldsValue(normalized);
                            setFormValues(normalized);
                        }
                    } catch {
                        // 解析失败时静默忽略，不影响用户当前输入
                    }
                    setSubmissionType('supplement');
                },
            });
        } catch {
            // 网络异常降级：静默忽略，不阻塞正常提交流程
        }
    }, [form]);

    useEffect(() => {
        const root = document.documentElement;
        const updateTheme = () => setIsDarkMode(root.dataset.theme === 'dark');

        updateTheme();
        const observer = new MutationObserver(updateTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

        return () => observer.disconnect();
    }, []);

    const md = useMemo(
        () =>
            new MarkdownIt({
                breaks: true,
                linkify: true,
                html: false,
            }),
        []
    );

    const markdownPreview = useMemo(() => serializeToMarkdown(formValues, authorName), [formValues, authorName]);
    const renderedMarkdownHtml = useMemo(() => md.render(markdownPreview), [md, markdownPreview]);

    function handleJsonParse() {
        const result = parseAndValidateJson(rawJson);

        if (!result.ok) {
            setParseSuccess('');
            setParseErrors(result.errors);
            return;
        }

        const normalized = normalizeIncomingData(result.data);
        form.setFieldsValue(normalized);
        setFormValues(normalized);
        setParseErrors([]);
        setParseSuccess('JSON 校验通过，表单已自动填充。请继续核对后再提交。');
    }

    function handleExportJson() {
        const json = serializeToJson(formValues, authorName);
        setRawJson(json);
        setParseErrors([]);
        setParseSuccess('已将当前表单内容导出为 JSON，可复制保存或直接重新导入。');
    }

    function handleDownload() {
        const blob = new Blob([markdownPreview], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'submission.md';
        a.click();
        URL.revokeObjectURL(url);
    }



    async function onSubmit() {
        const universityName = formValues.basicInfo.school;
        const collegeName = formValues.basicInfo.college;
        const markdownContent = serializeToMarkdown(formValues, authorName);

        setIsSubmitting(true);
        setSubmitResult(null);

        try {
            const response = await fetch('/api/submit_pr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ markdownContent, universityName, collegeName, turnstileToken, authorName, authorEmail, submissionType }),
            });

            const data = await response.json();

            if (response.ok) {
                // HTTP 200：提交成功，展示 PR 链接，并清除草稿
                try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
                setSubmitResult({ type: 'success', message: data.message, prUrl: data.prUrl });
            } else if (response.status === 504 || response.status === 502 || data.fallback) {
                // 容灾：自动触发本地下载，同时提示用户手动提交
                handleDownload();
                setSubmitResult({
                    type: 'fallback',
                    message: '网络异常，已为你自动下载 Markdown，请手动提交到 GitHub',
                });
            } else {
                // 其他错误：展示服务端返回的错误信息
                setSubmitResult({ type: 'error', message: data.error || '提交失败，请稍后重试' });
            }
        } catch (err) {
            // 网络层异常（如无法连接）：同样触发容灾下载
            handleDownload();
            setSubmitResult({
                type: 'fallback',
                message: '网络异常，已为你自动下载 Markdown，请手动提交到 GitHub',
            });
        } finally {
            setIsSubmitting(false);
            // 重置 Turnstile token，让 widget 自动刷新以便用户再次提交
            setTurnstileToken('');
        }
    }

    function isPendingDelete(type, key) {
        return pendingDelete?.type === type && pendingDelete?.key === key;
    }

    function handleDeleteClick(type, key, onConfirmRemove) {
        if (isPendingDelete(type, key)) {
            onConfirmRemove();
            setPendingDelete(null);
            return;
        }
        setPendingDelete({ type, key });
    }

    function handleDeleteBlur(type, key) {
        if (isPendingDelete(type, key)) {
            setPendingDelete(null);
        }
    }

    const themePrimary = isDarkMode ? '#b3c7ff' : '#3d50f5';

    return (
        <ConfigProvider
            theme={{
                algorithm: isDarkMode ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                token: {
                    colorPrimary: themePrimary,
                    colorText: 'var(--sl-color-text)',
                    colorTextSecondary: 'var(--sl-color-text-accent)',
                    colorBorder: 'var(--sl-color-hairline)',
                    colorBgBase: 'var(--sl-color-bg)',
                    colorBgContainer: 'var(--sl-color-bg-nav)',
                },
            }}
        >
            <section className="submit-form-root" style={{ marginTop: '1.5rem' }}>
                <Typography.Title level={2}>投稿信息填写</Typography.Title>
                <Typography.Paragraph>
                    先粘贴 AI 生成的 JSON，再在可视化表单中做最终核对。
                </Typography.Paragraph>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    {draftSavedAt && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            草稿已自动保存 · {draftSavedAt.toLocaleTimeString()}
                        </Typography.Text>
                    )}
                    <Button size="small" danger onClick={handleClearDraft}>
                        清除草稿
                    </Button>
                </div>

                <Card title="JSON 输入区" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Input.TextArea
                            value={rawJson}
                            onChange={(event) => setRawJson(event.target.value)}
                            rows={10}
                            placeholder="粘贴 AI 生成的 JSON"
                        />
                        <Button className="btn-add btn-parse" onClick={handleJsonParse}>
                            解析并填充表单
                        </Button>
                        <Button onClick={handleExportJson}>
                            导出表单为 JSON
                        </Button>
                        {parseSuccess ? <Alert type="success" showIcon message={parseSuccess} /> : null}
                        {parseErrors.length > 0 ? (
                            <Alert
                                type="error"
                                showIcon
                                message="JSON 校验失败"
                                description={
                                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                                        {parseErrors.map((errorItem) => (
                                            <li key={errorItem}>{errorItem}</li>
                                        ))}
                                    </ul>
                                }
                            />
                        ) : null}
                    </Space>
                </Card>

                <Form
                    form={form}
                    layout="vertical"
                    initialValues={defaultValues}
                    onFinish={onSubmit}
                    onValuesChange={(_, allValues) => setFormValues(allValues)}
                    onKeyDown={(e) => {
                        // Prevent Enter from triggering form submission in single-line inputs.
                        // TextArea fields handle their own Enter key (newline insertion).
                        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                            e.preventDefault();
                        }
                    }}
                >
                    <Card title="1. 基础信息速览" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        <div className="form-two-col-grid">
                            <Form.Item label="学校名称" name={['basicInfo', 'school']}>
                                <Input placeholder="学校名称" onBlur={checkExistingArchive} />
                            </Form.Item>
                            <Form.Item label="招生学院" name={['basicInfo', 'college']}>
                                <Input placeholder="招生学院" onBlur={checkExistingArchive} />
                            </Form.Item>
                            <Form.Item label="招生方向" name={['basicInfo', 'track']}>
                                <Input placeholder="招生方向" />
                            </Form.Item>
                            <Form.Item label="学制与学位" name={['basicInfo', 'degree']}>
                                <Input placeholder="学制与学位" />
                            </Form.Item>
                            <Form.Item className="grid-span-2" label="学制长度" name={['basicInfo', 'length']}>
                                <Input placeholder="学制长度" />
                            </Form.Item>
                        </div>
                    </Card>

                    <Card title="2. 官方时间轴与通知归档" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        <div className="form-two-col-grid">
                            <Form.Item className="grid-span-2" label="官网链接" name={['timeline', 'website']}>
                                <Input placeholder="https://..." />
                            </Form.Item>
                            <Form.Item label="夏令营发布时间" name={['timeline', 'summer', 'publish']}>
                                <Input placeholder="例如：5月中旬" />
                            </Form.Item>
                            <Form.Item label="夏令营截止时间" name={['timeline', 'summer', 'deadline']}>
                                <Input placeholder="例如：6月上旬" />
                            </Form.Item>
                            <Form.Item className="grid-span-2" label="夏令营通知链接（每行一个）" name={['timeline', 'summer', 'notices']}>
                                <Input.TextArea rows={3} />
                            </Form.Item>
                            <Form.Item label="预推免发布时间" name={['timeline', 'prePush', 'publish']}>
                                <Input placeholder="例如：8月下旬" />
                            </Form.Item>
                            <Form.Item className="grid-span-2" label="预推免通知链接（每行一个）" name={['timeline', 'prePush', 'notices']}>
                                <Input.TextArea rows={3} />
                            </Form.Item>
                        </div>

                        <Divider>其他关键文件</Divider>
                        <Form.List name={['timeline', 'otherDocs']}>
                            {(fields, { add, remove }) => (
                                <div className="list-stack">
                                    {fields.map((field) => (
                                        <Card key={field.key} size="small" className="editable-subsection">
                                            <div className="doc-row-grid">
                                                <Form.Item label="文件标题" name={[field.name, 'title']}>
                                                    <Input placeholder="推免生接收通知" />
                                                </Form.Item>
                                                <Form.Item label="文件链接" name={[field.name, 'url']}>
                                                    <Input placeholder="https://..." />
                                                </Form.Item>
                                                <div className="doc-row-action">
                                                    <Button
                                                        className={`btn-delete ${isPendingDelete('doc', field.key) ? 'btn-delete-confirm' : ''}`}
                                                        onClick={() =>
                                                            handleDeleteClick('doc', field.key, () => remove(field.name))
                                                        }
                                                        onBlur={() => handleDeleteBlur('doc', field.key)}
                                                    >
                                                        {isPendingDelete('doc', field.key) ? '确认删除' : '删除'}
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                    <Button className="btn-add" onClick={() => add({ title: '', url: '' })}>新增关键文件</Button>
                                </div>
                            )}
                        </Form.List>
                    </Card>

                    <Card title="3. 考核要求与备考攻略" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        <Form.List name="assessments">
                            {(fields, { add, remove }) => (
                                <div className="list-stack">
                                    {fields.map((field, index) => (
                                        <Card key={field.key} type="inner" title={`方向 ${index + 1}`} className="editable-subsection">
                                            <div className="form-two-col-grid">
                                                <Form.Item label="方向名称" name={[field.name, 'name']}>
                                                    <Input placeholder="例如：统计学直博" />
                                                </Form.Item>
                                                <Form.Item label="预计招生规模" name={[field.name, 'enrollment']}>
                                                    <Input placeholder="入营X人 / 优营X人 / 录取X人" />
                                                </Form.Item>
                                                <Form.Item label="考核形式" name={[field.name, 'format']}>
                                                    <Input placeholder="仅面试 / 笔试+面试 / 机试" />
                                                </Form.Item>
                                                <Form.Item label="笔试/专业课范围" name={[field.name, 'writtenScope']}>
                                                    <Input placeholder="数分 高代 概率论 数理统计" />
                                                </Form.Item>
                                                <Form.Item label="背景门槛" name={[field.name, 'bar']}>
                                                    <Input placeholder="是否卡排名、科研偏好等" />
                                                </Form.Item>
                                                <Form.Item label="面试偏好" name={[field.name, 'interviewPreference']}>
                                                    <Input placeholder="如有无英文面试" />
                                                </Form.Item>
                                                <Form.Item className="grid-span-2" label="综合经验贴（每行一个）" name={[field.name, 'experienceLinks']}>
                                                    <Input.TextArea rows={2} placeholder="多方向综合贴统一放第一个方向下，请确保你复制的单个链接在一行内" />
                                                </Form.Item>
                                                <Form.Item className="grid-span-2" label="优营/预推免名单贴（每行一个）" name={[field.name, 'admissionListLinks']}>
                                                    <Input.TextArea rows={2} />
                                                </Form.Item>
                                                <Form.Item className="grid-span-2" label="面试经验贴（每行一个）" name={[field.name, 'interviewLinks']}>
                                                    <Input.TextArea rows={2} />
                                                </Form.Item>
                                                <Form.Item className="grid-span-2" label="真题分享贴（每行一个）" name={[field.name, 'examLinks']}>
                                                    <Input.TextArea rows={2} />
                                                </Form.Item>
                                                <div className="grid-span-2 section-action-row">
                                                    <Button
                                                        className={`btn-delete ${isPendingDelete('assessment', field.key) ? 'btn-delete-confirm' : ''}`}
                                                        onClick={() =>
                                                            handleDeleteClick('assessment', field.key, () => remove(field.name))
                                                        }
                                                        onBlur={() => handleDeleteBlur('assessment', field.key)}
                                                    >
                                                        {isPendingDelete('assessment', field.key) ? '确认删除' : '删除该方向'}
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                    <Button className="btn-add" onClick={() => add(defaultValues.assessments[0])}>新增方向</Button>
                                </div>
                            )}
                        </Form.List>
                    </Card>

                    <Card title="4. 其他碎碎念与避雷贴" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        <Form.Item label="就读体验/吐槽贴（每行一个）" name={['misc', 'notesLinks']}>
                            <Input.TextArea rows={3} />
                        </Form.Item>
                    </Card>

                    <Card title="5. 投稿署名" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        {/* 关键修复：加入 alignItems: 'flex-end'，强制底部（即输入框）对齐 */}
                        <div
                        className="form-two-col-grid"
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'flex-end' }}
                        >
                            <div style={{ width: '100%' }}>
                            <label htmlFor="author-name" style={{ display: 'block', marginBottom: 4 }}>署名（可匿名）</label>
                            <Input
                            id="author-name"
                            placeholder="你的昵称，留空则匿名"
                            value={authorName}
                            onChange={(e) => setAuthorName(e.target.value)}
                            />
                            </div>
                                <div style={{ width: '100%' }}>
                                <label htmlFor="author-email" style={{ display: 'block', marginBottom: 4 }}>邮箱（可选，仅用于联系）</label>
                                <Input
                                id="author-email"
                                type="email"
                                placeholder="your@email.com"
                                value={authorEmail}
                                onChange={(e) => setAuthorEmail(e.target.value)}
                                />
                                </div>
                        </div>
                    </Card>

                    <Card title="提交意图" size="small" className="editable-section" style={{ marginBottom: 16 }}>
                        <Radio.Group value={submissionType} onChange={(e) => setSubmissionType(e.target.value)}>
                            <Radio value="new">全新创建（该学院还没有档案）</Radio>
                            <Radio value="supplement">补充 / 纠错已有档案</Radio>
                        </Radio.Group>
                    </Card>

                    <div style={{ marginBottom: 4 }}>
                        <Turnstile
                            siteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "你的真实SITE_KEY"}
                            onSuccess={(token) => { setTurnstileToken(token); setTurnstileMsg(null); }}
                            onError={() => {
                                setTurnstileToken('');
                                setTurnstileMsg({ type: 'error', text: '验证码加载失败，请刷新页面或切换网络重试。若启用了广告拦截插件，请暂时关闭后再试。' });
                            }}
                            onExpire={() => {
                                setTurnstileToken('');
                                setTurnstileMsg({ type: 'warning', text: '验证码已过期，请重新完成验证后再提交。' });
                            }}
                        />
                    </div>
                    {/* 验证状态提示：仅在未完成验证或出错时显示 */}
                    {turnstileMsg ? (
                        <Alert type={turnstileMsg.type} showIcon message={turnstileMsg.text} style={{ marginBottom: 8 }} />
                    ) : !turnstileToken ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                            等待人机验证完成
                        </Typography.Text>
                    ) : (
                        <Typography.Text type="success" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                            ✓ 人机验证已完成
                        </Typography.Text>
                    )}

                    <div style={{ display: 'flex', gap: '16px', marginBottom: 12 }}>
                        <Button
                        htmlType="submit"
                        type="primary"
                        loading={isSubmitting}
                        disabled={!turnstileToken}
                        size="small"
                        style={{
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                        >
                        提交投稿
                        </Button>
                        <Button
                        onClick={handleDownload}
                        size="small"
                        style={{
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                        >
                        下载 Markdown
                        </Button>
                    </div>
                    {submitResult?.type === 'success' && (
                        <Alert
                            type="success"
                            showIcon
                            style={{ marginTop: 12 }}
                            message={submitResult.message}
                            description={
                                submitResult.prUrl ? (
                                    <a href={submitResult.prUrl} target="_blank" rel="noreferrer">
                                        查看你的 PR →
                                    </a>
                                ) : null
                            }
                        />
                    )}
                    {submitResult?.type === 'fallback' && (
                        <Alert
                            type="warning"
                            showIcon
                            style={{ marginTop: 12 }}
                            message={submitResult.message}
                        />
                    )}
                    {submitResult?.type === 'error' && (
                        <Alert
                            type="error"
                            showIcon
                            style={{ marginTop: 12 }}
                            message={submitResult.message}
                        />
                    )}
                </Form>

                <Card title="Markdown 实时渲染预览（markdown-it）" size="small" style={{ marginTop: 16 }}>
                    <div
                        style={{
                            maxHeight: 460,
                            overflow: 'auto',
                            border: '1px solid var(--sl-color-hairline)',
                            borderRadius: 6,
                            padding: 12,
                            background: 'var(--sl-color-bg)',
                        }}
                        dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
                    />
                </Card>

                <Card title="原始 Markdown" size="small" style={{ marginTop: 16 }}>
                    <pre
                        style={{
                            maxHeight: 280,
                            overflow: 'auto',
                            margin: 0,
                            padding: 12,
                            borderRadius: 6,
                            border: '1px solid var(--sl-color-hairline)',
                            background: 'var(--sl-color-bg)',
                        }}
                    >
                        {markdownPreview}
                    </pre>
                </Card>

            </section>
        </ConfigProvider>
    );
}
