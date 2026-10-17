
<script lang="ts">
    import { onMount } from 'svelte';

    type Service = {
        name: string;
        displayName: string;
        port: number;
        status: string;
        pid: number | null;
        managed: boolean;
    };

    let services: Service[] = $state([]);
    let error = $state('');
    let busy: string[] = $state([]);

    async function loadServices() {
        try {
            const response = await fetch('/api/services');

            if (!response.ok) {
                throw new Error('Failed to fetch services');
            }

            services = await response.json();
            error = '';
        } catch {
            error = 'Cannot connect to the service manager';
        }
    }

    async function control(name: string, command: string) {
        if (busy.includes(name)) return;

        busy = [...busy, name];

        try {
            const response = await fetch('/api/services/control', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, command })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Operation failed');
            }

            await loadServices();
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Operation failed');
        } finally {
            busy = busy.filter(item => item !== name);
        }
    }

    onMount(() => {
        loadServices();

        const interval = setInterval(loadServices, 3000);

        return () => clearInterval(interval);
    });
</script>

<svelte:head>
    <title>Service Monitor</title>
</svelte:head>

<main>
    <header>
        <h1>Service Monitor</h1>
        <p>Faculty of Fictional Sciences</p>
    </header>

    {#if error}
        <p class="error">{error}</p>
    {/if}

    <div class="services">
        {#each services as service (service.name)}
            <div class="service">
                <div class="info">
                    <span class:online={service.status === 'healthy'}
                          class="indicator"></span>

                    <div>
                        <h2>{service.displayName}</h2>
                        <small>
                            Port {service.port} · {service.status}
                        </small>
                    </div>
                </div>

                <div class="actions">
                    <button
                        disabled={busy.includes(service.name) || service.status !== 'offline' || service.managed}
                        onclick={() => control(service.name, 'start')}
                    >
                        Start
                    </button>

                    <button
                        disabled={busy.includes(service.name) || !service.managed}
                        onclick={() => control(service.name, 'stop')}
                    >
                        Stop
                    </button>

                    <button
                        disabled={busy.includes(service.name) || !service.managed}
                        onclick={() => control(service.name, 'restart')}
                    >
                        Restart
                    </button>
                </div>
            </div>
        {/each}
    </div>
</main>

<style>
    :global(body) {
        margin: 0;
        background: #f5f5f5;
        color: #222;
        font-family: Arial, sans-serif;
    }

    main {
        max-width: 900px;
        margin: 80px auto;
        padding: 0 24px;
    }

    header {
        margin-bottom: 40px;
    }

    h1 {
        margin: 0;
        font-size: 32px;
    }

    header p {
        color: #777;
    }

    .services {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .service {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 20px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
    }

    .info {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #e05252;
        flex-shrink: 0;
    }

    .indicator.online {
        background: #37a66b;
    }

    h2 {
        margin: 0 0 6px;
        font-size: 16px;
    }

    small {
        color: #777;
        text-transform: capitalize;
    }

    .actions {
        display: flex;
        gap: 8px;
    }

    button {
        padding: 9px 14px;
        border: 1px solid #ccc;
        border-radius: 5px;
        background: white;
        cursor: pointer;
    }

    button:hover:not(:disabled) {
        background: #eee;
    }

    button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .error {
        color: #c33;
    }

    @media (max-width: 650px) {
        .service {
            align-items: flex-start;
            flex-direction: column;
        }

        .actions {
            flex-wrap: wrap;
        }
    }
</style>
