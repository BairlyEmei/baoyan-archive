import Ajv from 'ajv';

export const submissionSchema = {
    type: 'object',
    properties: {
        basicInfo: {
            type: 'object',
            properties: {
                school: { type: 'string' },
                college: { type: 'string' },
                track: { type: 'string' },
                degree: { type: 'string' },
                length: { type: 'string' },
            },
            additionalProperties: false,
        },
        timeline: {
            type: 'object',
            properties: {
                website: { type: 'string', pattern: '^(https?://|$)' },
                summer: {
                    type: 'object',
                    properties: {
                        publish: { type: 'string' },
                        deadline: { type: 'string' },
                        notices: {
                            type: 'array',
                            items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                        },
                    },
                    additionalProperties: false,
                },
                prePush: {
                    type: 'object',
                    properties: {
                        publish: { type: 'string' },
                        notices: {
                            type: 'array',
                            items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                        },
                    },
                    additionalProperties: false,
                },
                otherDocs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            url: { type: 'string', pattern: '^https?://' },
                        },
                        required: ['title', 'url'],
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        assessments: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    enrollment: { type: 'string' },
                    format: { type: 'string' },
                    writtenScope: { type: 'string' },
                    bar: { type: 'string' },
                    interviewPreference: { type: 'string' },
                    experienceLinks: {
                        type: 'array',
                        items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                    },
                    admissionListLinks: {
                        type: 'array',
                        items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                    },
                    interviewLinks: {
                        type: 'array',
                        items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                    },
                    examLinks: {
                        type: 'array',
                        items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                    },
                },
                additionalProperties: false,
            },
        },
        misc: {
            type: 'object',
            properties: {
                notesLinks: {
                    type: 'array',
                    items: { type: 'string', pattern: '^(https?://|\\[[^\\]]*\\]\\(https?://)' },
                },
            },
            additionalProperties: false,
        },
        attribution: { type: 'string' },
    },
    required: ['basicInfo', 'timeline', 'assessments', 'misc'],
    additionalProperties: false,
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(submissionSchema);

function cleanJsonBlock(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
        return '';
    }

    const noFence = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    return noFence;
}

function mapAjvErrors(errors = []) {
    return errors.map((err) => {
        const path = err.instancePath ? err.instancePath : '(root)';
        return `${path} ${err.message || 'invalid value'}`;
    });
}

export function parseAndValidateJson(rawText) {
    const cleaned = cleanJsonBlock(rawText);

    if (!cleaned) {
        return {
            ok: false,
            data: null,
            errors: ['请输入 JSON 内容后再解析。'],
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (error) {
        return {
            ok: false,
            data: null,
            errors: [`JSON 解析失败: ${error.message}`],
        };
    }

    const ok = validate(parsed);
    if (!ok) {
        return {
            ok: false,
            data: null,
            errors: mapAjvErrors(validate.errors),
        };
    }

    return {
        ok: true,
        data: parsed,
        errors: [],
    };
}
