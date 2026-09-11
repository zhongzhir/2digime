# Institution Adapter verify (Slice C)

Headless real verification of client Institution Adapter:

1. Backend bootstrap Demo Telecom  
2. Adapter `session/exchange` for low/high users  
3. Write two profiles (mode + model-config)  
4. `DigitalMeRuntime` Talk via existing `chatComplete` path  
5. Quota isolation + personal-mode regression checks  

```powershell
# LiteLLM spike must be up; then:
node institution/adapter-verify/run-verify.cjs
```

Success: `INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_ACCEPTED`
